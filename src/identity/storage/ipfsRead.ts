import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { equals } from 'multiformats/bytes'
import { exporter } from 'ipfs-unixfs-exporter'
import {
  createAdaptiveFetch,
  createRace,
  failureWords,
  hostOf,
  isAbortError,
  RaceError,
  rankUrls,
  readBody,
  type FetchLike,
} from '../../net/adaptive.js'

const RAW_CODEC = 0x55
const DAG_PB_CODEC = 0x70
const SHA2_256 = 0x12
const IDENTITY_HASH = 0x00

// Seeds only: sources found through content routing join them, PINATA_GATEWAY_URL
// goes first, and ETHAGENT_IPFS_GATEWAYS / ETHAGENT_IPFS_ROUTERS replace them.
const GATEWAY_SEEDS = ['https://ipfs.filebase.io', 'https://gateway.pinata.cloud', 'https://dweb.link']
const ROUTER_SEEDS = ['https://delegated-ipfs.dev']

type SourceKind = 'gateway' | 'trustless'
type Source = { base: string; host: string; kind: SourceKind }

export type IpfsReadProgress = { bytes: number; total?: number; host: string }

export type IpfsReadOptions = {
  signal?: AbortSignal
  onProgress?: (progress: IpfsReadProgress) => void
  fetchImpl?: FetchLike
}

export type IpfsReadOutcome = { host: string; outcome: string }

export class IpfsReadError extends Error {
  readonly cid: string
  readonly outcomes: IpfsReadOutcome[]
  constructor(cid: string, outcomes: IpfsReadOutcome[]) {
    super(outcomes.length
      ? `No IPFS source returned ${shortCid(cid)}: ${outcomes.map(item => `${item.host} ${item.outcome}`).join(', ')}.`
      : `No IPFS source was available for ${shortCid(cid)}.`)
    this.name = 'IpfsReadError'
    this.cid = cid
    this.outcomes = outcomes
  }
}

// 429 and 503 are a gateway asking for time, so the race comes back to it. A 504 is
// how public gateways report content they could not find, and waiting does not help.
const BUSY_STATUS = new Set([429, 503])

class SourceStatusError extends Error {
  readonly words: string
  readonly busy: boolean
  constructor(host: string, status: number) {
    const words = statusWords(status)
    super(`${host}: ${words}`)
    this.name = 'SourceStatusError'
    this.words = words
    this.busy = BUSY_STATUS.has(status)
  }
}

class ContentMismatchError extends Error {
  readonly words = 'returned the wrong bytes'
  constructor(host: string) {
    super(`${host}: returned the wrong bytes`)
    this.name = 'ContentMismatchError'
  }
}

function statusWords(status: number): string {
  if (status === 404 || status === 410) return 'not found'
  if (status === 429) return 'rate limited'
  if (status === 400 || status === 401 || status === 403 || status === 406 || status === 415 || status === 501) return 'refused the request'
  if (status >= 500) return 'server error'
  return `HTTP ${status}`
}

function shortCid(cid: string): string {
  return cid.length > 20 ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : cid
}

function listFromEnv(name: string, seeds: readonly string[]): string[] {
  const raw = process.env[name]
  if (raw === undefined) return [...seeds]
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function normalizeBase(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function toSource(base: string, kind: SourceKind): Source {
  const normalized = normalizeBase(base)
  return { base: normalized, host: hostOf(normalized), kind }
}

function rankSources(sources: Source[]): Source[] {
  const byBase = new Map(sources.map(source => [source.base, source]))
  return rankUrls([...byBase.keys()]).map(base => byBase.get(base)!)
}

function parseCid(value: string): CID | null {
  if (!value || value.includes('/')) return null
  try {
    return CID.parse(value)
  } catch {
    return null
  }
}

export function multiaddrToGatewayBase(addr: string): string | null {
  const parts = addr.split('/').filter(Boolean)
  let host = ''
  let port = ''
  let tls = false
  let http = false
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part === 'dns' || part === 'dns4' || part === 'dns6' || part === 'ip4') host = parts[++index] ?? ''
    else if (part === 'ip6') host = `[${parts[++index] ?? ''}]`
    else if (part === 'tcp') port = parts[++index] ?? ''
    else if (part === 'https') { tls = true; http = true }
    else if (part === 'tls') tls = true
    else if (part === 'http') http = true
    else if (part === 'sni') index += 1
  }
  if (!host || !http || !tls) return null
  return `https://${host}${port && port !== '443' ? `:${port}` : ''}`
}

type RoutingProvider = { Protocols?: unknown; Addrs?: unknown }

function providersToSources(body: unknown): Source[] {
  const providers = (body as { Providers?: unknown })?.Providers
  if (!Array.isArray(providers)) return []
  const bases = new Set<string>()
  for (const provider of providers as RoutingProvider[]) {
    const protocols = Array.isArray(provider.Protocols) ? provider.Protocols : []
    if (!protocols.includes('transport-ipfs-gateway-http')) continue
    const addrs = Array.isArray(provider.Addrs) ? provider.Addrs : []
    for (const addr of addrs) {
      const base = typeof addr === 'string' ? multiaddrToGatewayBase(addr) : null
      if (base) bases.add(base)
    }
  }
  return [...bases].map(base => toSource(base, 'trustless'))
}

const discoveries = new Map<string, Promise<Source[]>>()

function discoverTrustlessSources(cid: CID, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Source[]> {
  const key = cid.toString()
  const cached = discoveries.get(key)
  if (cached) return cached
  const routers = listFromEnv('ETHAGENT_IPFS_ROUTERS', ROUTER_SEEDS).map(normalizeBase)
  const discovery = (async (): Promise<Source[]> => {
    if (routers.length === 0) return []
    const race = createRace<Source[]>(signal)
    for (const router of rankUrls(routers)) {
      race.add({
        host: hostOf(router),
        run: async attemptSignal => {
          const response = await fetchImpl(`${router}/routing/v1/providers/${key}`, {
            headers: { accept: 'application/json' },
            signal: attemptSignal,
          })
          if (response.status === 404) {
            await response.body?.cancel().catch(() => {})
            return []
          }
          if (!response.ok) {
            await response.body?.cancel().catch(() => {})
            throw new SourceStatusError(hostOf(router), response.status)
          }
          return providersToSources(await response.json().catch(() => null))
        },
      })
    }
    race.close()
    try {
      return await race.result
    } catch {
      return []
    }
  })()
  discoveries.set(key, discovery)
  void discovery.then(found => {
    if (signal?.aborted || found.length === 0) discoveries.delete(key)
  })
  return discovery
}

type SourcePool = {
  configured: Source[]
  gateways: Source[]
  discovered: Source[]
  discovery: Promise<void> | null
}

function createPool(cid: CID | null, fetchImpl: FetchLike, signal?: AbortSignal): SourcePool {
  const configuredUrl = process.env.PINATA_GATEWAY_URL?.trim()
  const configured = configuredUrl ? [toSource(configuredUrl, 'gateway')] : []
  const gateways = listFromEnv('ETHAGENT_IPFS_GATEWAYS', GATEWAY_SEEDS)
    .map(base => toSource(base, 'gateway'))
    .filter(source => !configured.some(item => item.base === source.base))
  const pool: SourcePool = { configured, gateways, discovered: [], discovery: null }
  if (cid) {
    pool.discovery = discoverTrustlessSources(cid, fetchImpl, signal).then(found => {
      const known = new Set([...configured, ...gateways].map(source => source.host))
      pool.discovered = found.filter(source => !known.has(source.host))
    })
  }
  return pool
}

function orderedSources(pool: SourcePool, includeDiscovered = true): Source[] {
  return [...pool.configured, ...rankSources([...(includeDiscovered ? pool.discovered : []), ...pool.gateways])]
}

function blockRequest(source: Source, cid: CID): { url: string; headers?: Record<string, string> } {
  const id = cid.toString()
  if (source.kind === 'gateway' && cid.code === RAW_CODEC) return { url: `${source.base}/ipfs/${id}` }
  return { url: `${source.base}/ipfs/${id}?format=raw`, headers: { accept: 'application/vnd.ipld.raw' } }
}

async function verifyBlock(cid: CID, bytes: Uint8Array, host: string): Promise<void> {
  const code = cid.multihash.code
  if (code === IDENTITY_HASH) {
    if (!equals(cid.multihash.digest, bytes)) throw new ContentMismatchError(host)
    return
  }
  if (code !== SHA2_256) return
  const digest = await sha256.digest(bytes)
  if (!equals(digest.digest, cid.multihash.digest)) throw new ContentMismatchError(host)
}

type FetchedBlock = { bytes: Uint8Array; host: string }

async function fetchBlock(
  cid: CID,
  pool: SourcePool,
  fetchImpl: FetchLike,
  signal: AbortSignal | undefined,
): Promise<FetchedBlock> {
  if (cid.multihash.code === IDENTITY_HASH) return { bytes: cid.multihash.digest, host: 'inline' }
  const race = createRace<FetchedBlock>(signal)
  const tried = new Set<string>()
  const add = (source: Source): void => {
    if (tried.has(source.base)) return
    tried.add(source.base)
    race.add({
      host: source.host,
      run: async attemptSignal => {
        const request = blockRequest(source, cid)
        const response = await fetchImpl(request.url, {
          ...(request.headers ? { headers: request.headers } : {}),
          signal: attemptSignal,
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          throw new SourceStatusError(source.host, response.status)
        }
        const bytes = await readBody(response)
        await verifyBlock(cid, bytes, source.host)
        return { bytes, host: source.host }
      },
    })
  }
  for (const source of orderedSources(pool)) add(source)
  if (pool.discovery) {
    void pool.discovery.then(() => {
      for (const source of orderedSources(pool)) add(source)
    }).finally(() => race.close())
  } else {
    race.close()
  }
  return race.result
}

async function exportFile(
  root: CID,
  pool: SourcePool,
  fetchImpl: FetchLike,
  options: IpfsReadOptions,
): Promise<Uint8Array> {
  let host = ''
  const blockstore = {
    async *get(cid: CID, getOptions?: { signal?: AbortSignal }): AsyncGenerator<Uint8Array> {
      const block = await fetchBlock(cid, pool, fetchImpl, getOptions?.signal ?? options.signal)
      host = block.host
      yield block.bytes
    },
  }
  const entry = await exporter(root, blockstore, options.signal ? { signal: options.signal } : {})
  if (entry.type !== 'file' && entry.type !== 'raw' && entry.type !== 'identity') {
    throw new Error(`${shortCid(root.toString())} is a ${entry.type}, not a file`)
  }
  const total = Number(entry.size)
  const chunks: Uint8Array[] = []
  let received = 0
  for await (const chunk of entry.content(options.signal ? { signal: options.signal } : {})) {
    chunks.push(chunk)
    received += chunk.byteLength
    options.onProgress?.({ bytes: received, total, host })
  }
  return concat(chunks, received)
}

async function readWholeFile(
  path: string,
  sources: Source[],
  fetchImpl: FetchLike,
  options: IpfsReadOptions,
): Promise<Uint8Array> {
  const encoded = path.split('/').map(part => encodeURIComponent(part)).join('/')
  const race = createRace<Uint8Array>(options.signal)
  let leader = 0
  for (const source of sources) {
    race.add({
      host: source.host,
      run: async attemptSignal => {
        const response = await fetchImpl(`${source.base}/ipfs/${encoded}`, { signal: attemptSignal })
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          throw new SourceStatusError(source.host, response.status)
        }
        const length = Number(response.headers.get('content-length') ?? '') || undefined
        const bytes = await readBody(response, received => {
          if (received < leader) return
          leader = received
          options.onProgress?.({ bytes: received, ...(length ? { total: length } : {}), host: source.host })
        })
        return bytes
      },
    })
  }
  race.close()
  return race.result
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]!.byteLength === length) return chunks[0]!
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function outcomesOf(...errors: unknown[]): IpfsReadOutcome[] {
  const byHost = new Map<string, string>()
  const visit = (err: unknown): void => {
    if (err instanceof RaceError) {
      for (const failure of err.failures) {
        if (failure.error instanceof RaceError) visit(failure.error)
        else byHost.set(failure.host, failureWords(failure.error))
      }
      return
    }
    const nested = (err as { cause?: unknown })?.cause
    if (nested instanceof RaceError) visit(nested)
  }
  for (const err of errors) visit(err)
  return [...byHost].map(([host, outcome]) => ({ host, outcome }))
}

function rethrowIfCancelled(err: unknown, signal?: AbortSignal): void {
  if (signal?.aborted || isAbortError(err)) throw err
}

export async function readIpfs(cidText: string, options: IpfsReadOptions = {}): Promise<Uint8Array> {
  const fetchImpl = createAdaptiveFetch(options.fetchImpl)
  const trimmed = cidText.trim()
  const cid = parseCid(trimmed)
  const pool = createPool(cid, fetchImpl, options.signal)

  if (!cid) {
    try {
      return await readWholeFile(trimmed, orderedSources(pool, false), fetchImpl, options)
    } catch (err: unknown) {
      rethrowIfCancelled(err, options.signal)
      throw new IpfsReadError(trimmed, outcomesOf(err))
    }
  }

  if (cid.code === DAG_PB_CODEC) {
    try {
      return await exportFile(cid, pool, fetchImpl, options)
    } catch (verifiedErr: unknown) {
      rethrowIfCancelled(verifiedErr, options.signal)
      try {
        return await readWholeFile(trimmed, orderedSources(pool, false), fetchImpl, options)
      } catch (plainErr: unknown) {
        rethrowIfCancelled(plainErr, options.signal)
        throw new IpfsReadError(trimmed, outcomesOf(verifiedErr, plainErr))
      }
    }
  }

  try {
    const block = await fetchBlock(cid, pool, fetchImpl, options.signal)
    options.onProgress?.({ bytes: block.bytes.byteLength, total: block.bytes.byteLength, host: block.host })
    return block.bytes
  } catch (err: unknown) {
    rethrowIfCancelled(err, options.signal)
    throw new IpfsReadError(trimmed, outcomesOf(err))
  }
}

export async function probeIpfs(cidText: string, options: IpfsReadOptions = {}): Promise<boolean> {
  const fetchImpl = createAdaptiveFetch(options.fetchImpl)
  const trimmed = cidText.trim()
  const cid = parseCid(trimmed)
  const pool = createPool(cid, fetchImpl, options.signal)
  try {
    if (cid) {
      await fetchBlock(cid, pool, fetchImpl, options.signal)
      return true
    }
    await readWholeFile(trimmed, orderedSources(pool, false), fetchImpl, options)
    return true
  } catch (err: unknown) {
    rethrowIfCancelled(err, options.signal)
    return false
  }
}

export function resetIpfsDiscoveryForTest(): void {
  discoveries.clear()
}
