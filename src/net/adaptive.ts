import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { getConfigDir } from '../storage/config.js'

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

// RFC 6298 section 2: smoothing gains, the variance multiplier, the initial and
// minimum retransmission timeout, and the largest backoff the timeout may reach.
// Every wait below is derived from these and from what each host has shown us.
const RTT_GAIN = 1 / 8
const VARIANCE_GAIN = 1 / 4
const VARIANCE_WEIGHT = 4
const INITIAL_RTO_MS = 1_000
const MIN_RTO_MS = 1_000
const MAX_RTO_MS = 60_000

type HostStats = {
  srtt?: number
  rttvar?: number
  samples: number
  failures: number
  lastFailureAt?: number
  lastSuccessAt?: number
  // The widest eth_getLogs block range this host has served or named as its limit.
  logRange?: number
}

const hosts = new Map<string, HostStats>()
let loaded = false
let writeQueued = false
let changes = 0
let changesSaved = 0
let exitHooked = false

function statsFile(): string | null {
  const configured = process.env.ETHAGENT_HOSTS_FILE
  if (configured !== undefined) return configured.trim() || null
  return path.join(getConfigDir(), 'hosts.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  const file = statsFile()
  if (!file) return
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Partial<HostStats>>
    for (const [host, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object') continue
      hosts.set(host, {
        samples: Number(value.samples) || 0,
        failures: Number(value.failures) || 0,
        ...(Number.isFinite(value.srtt) ? { srtt: Number(value.srtt) } : {}),
        ...(Number.isFinite(value.rttvar) ? { rttvar: Number(value.rttvar) } : {}),
        ...(Number.isFinite(value.lastFailureAt) ? { lastFailureAt: Number(value.lastFailureAt) } : {}),
        ...(Number.isFinite(value.lastSuccessAt) ? { lastSuccessAt: Number(value.lastSuccessAt) } : {}),
        ...(Number.isFinite(value.logRange) && Number(value.logRange) > 0 ? { logRange: Number(value.logRange) } : {}),
      })
    }
  } catch {
    hosts.clear()
  }
}

function statsText(): string {
  const measured = [...hosts].filter(([, stats]) => stats.samples > 0 || stats.failures > 0 || stats.logRange !== undefined)
  return `${JSON.stringify(Object.fromEntries(measured), null, 2)}\n`
}

// A one-shot command ends before a deferred write gets its turn, so whatever is still
// unsaved goes out synchronously as the process exits.
function saveOnExit(): void {
  if (changesSaved === changes) return
  const file = statsFile()
  if (!file) return
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, statsText(), { mode: 0o600 })
    renameSync(temp, file)
  } catch {
    // The cache is an optimization; losing one update costs nothing.
  }
}

function persist(): void {
  const file = statsFile()
  if (!file) return
  changes += 1
  if (!exitHooked) {
    exitHooked = true
    process.once('exit', saveOnExit)
  }
  if (writeQueued) return
  writeQueued = true
  setImmediate(() => {
    writeQueued = false
    const upTo = changes
    void mkdir(path.dirname(file), { recursive: true })
      .then(() => atomicWriteText(file, statsText()))
      .then(() => { changesSaved = Math.max(changesSaved, upTo) }, () => {})
  }).unref?.()
}

function statsFor(host: string): HostStats {
  load()
  let stats = hosts.get(host)
  if (!stats) {
    stats = { samples: 0, failures: 0 }
    hosts.set(host, stats)
  }
  return stats
}

export function hostOf(url: string | URL): string {
  try {
    return new URL(String(url)).host
  } catch {
    return String(url)
  }
}

export function rto(host: string): number {
  const stats = statsFor(host)
  if (stats.srtt === undefined || stats.rttvar === undefined) return INITIAL_RTO_MS
  return Math.min(MAX_RTO_MS, Math.max(MIN_RTO_MS, stats.srtt + VARIANCE_WEIGHT * stats.rttvar))
}

export const BACKOFF_CEILING_MS = MAX_RTO_MS

export function withinBackoffCeiling(ms: number): boolean {
  return ms <= MAX_RTO_MS
}

export function noteResponse(host: string, elapsedMs: number): void {
  const stats = statsFor(host)
  const sample = Math.max(0, elapsedMs)
  if (stats.srtt === undefined || stats.rttvar === undefined) {
    stats.srtt = sample
    stats.rttvar = sample / 2
  } else {
    stats.rttvar = (1 - VARIANCE_GAIN) * stats.rttvar + VARIANCE_GAIN * Math.abs(stats.srtt - sample)
    stats.srtt = (1 - RTT_GAIN) * stats.srtt + RTT_GAIN * sample
  }
  stats.samples += 1
  stats.failures = 0
  stats.lastSuccessAt = Date.now()
  persist()
}

export function noteFailure(host: string): void {
  const stats = statsFor(host)
  stats.failures += 1
  stats.lastFailureAt = Date.now()
  persist()
}

export function learnedLogRange(host: string): number | undefined {
  return statsFor(host).logRange
}

export function noteLogRange(host: string, blocks: number): void {
  const stats = statsFor(host)
  if (stats.logRange === blocks) return
  stats.logRange = blocks
  persist()
}

export function isFailing(host: string): boolean {
  return statsFor(host).failures > 0
}

function expectedLatency(host: string): number {
  const stats = statsFor(host)
  return stats.srtt ?? INITIAL_RTO_MS
}

export function rankUrls<T extends string>(urls: readonly T[]): T[] {
  const scored = urls.map((url, index) => {
    const host = hostOf(url)
    const stats = statsFor(host)
    return { url, index, failing: stats.failures > 0, lastFailureAt: stats.lastFailureAt ?? 0, latency: expectedLatency(host) }
  })
  scored.sort((a, b) => {
    if (a.failing !== b.failing) return a.failing ? 1 : -1
    if (a.failing && b.failing) return a.lastFailureAt - b.lastFailureAt || a.index - b.index
    return a.latency - b.latency || a.index - b.index
  })
  return scored.map(entry => entry.url)
}

export function resetHostStatsForTest(reload = false): void {
  hosts.clear()
  loaded = !reload
}

export type NetFailure = 'no-response' | 'stalled' | 'reset' | 'dns' | 'refused' | 'connect-timeout' | 'tls' | 'unreachable'

const FAILURE_WORDS: Record<NetFailure, string> = {
  'no-response': 'no response',
  stalled: 'stopped sending data',
  reset: 'connection reset',
  dns: 'DNS lookup failed',
  refused: 'connection refused',
  'connect-timeout': 'connection timed out',
  tls: 'TLS error',
  unreachable: 'unreachable',
}

export class NetError extends Error {
  readonly host: string
  readonly failure: NetFailure
  constructor(host: string, failure: NetFailure, options?: { cause?: unknown }) {
    super(`${host}: ${FAILURE_WORDS[failure]}`, options)
    this.name = 'NetError'
    this.host = host
    this.failure = failure
  }

  get words(): string {
    return FAILURE_WORDS[this.failure]
  }
}

function causeCode(err: unknown): string {
  let current: unknown = err
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

function classify(err: unknown): NetFailure {
  const code = causeCode(err)
  if (/^(ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED)$/.test(code)) return 'reset'
  if (/^(ENOTFOUND|EAI_AGAIN|EAI_NONAME)$/.test(code)) return 'dns'
  if (code === 'ECONNREFUSED') return 'refused'
  if (/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/.test(code)) return 'connect-timeout'
  if (/^(CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO)/.test(code)) return 'tls'
  return 'unreachable'
}

export function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError')
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const err = new Error('The operation was cancelled.')
  err.name = 'AbortError'
  return err
}

class SilenceWatchdog {
  private timer: ReturnType<typeof setTimeout> | undefined
  private bound: number

  constructor(private readonly host: string, private readonly giveUp: () => void) {
    this.bound = rto(host)
  }

  activity(): void {
    this.bound = rto(this.host)
    this.arm()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.expire(), this.bound)
    this.timer.unref?.()
  }

  private expire(): void {
    const next = this.bound * 2
    if (next > MAX_RTO_MS) {
      this.stop()
      this.giveUp()
      return
    }
    this.bound = next
    this.arm()
  }
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304])

function requestUrl(input: string | URL): string {
  return typeof input === 'string' ? input : input.href
}

export function createAdaptiveFetch(base: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  return async (input, init = {}) => {
    const host = hostOf(requestUrl(input))
    const external = init.signal ?? undefined
    if (external?.aborted) throw abortError(external.reason)
    const controller = new AbortController()
    let phase: 'waiting' | 'reading' = 'waiting'
    let silent: NetError | undefined
    const watchdog = new SilenceWatchdog(host, () => {
      silent = new NetError(host, phase === 'waiting' ? 'no-response' : 'stalled')
      controller.abort(silent)
    })
    const onExternalAbort = (): void => controller.abort(abortError(external?.reason))
    external?.addEventListener('abort', onExternalAbort, { once: true })
    const release = (): void => {
      watchdog.stop()
      external?.removeEventListener('abort', onExternalAbort)
    }

    let body = init.body
    if (body instanceof ReadableStream) {
      body = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, sink) {
          watchdog.activity()
          sink.enqueue(chunk)
        },
      }))
    }

    const started = performance.now()
    watchdog.activity()
    let response: Response
    try {
      response = await base(input, { ...init, ...(body !== init.body ? { body } : {}), signal: controller.signal })
    } catch (err: unknown) {
      release()
      if (external?.aborted) throw abortError(external.reason)
      noteFailure(host)
      if (silent) throw silent
      throw new NetError(host, classify(err), { cause: err })
    }
    noteResponse(host, performance.now() - started)
    phase = 'reading'

    if (!response.body || NULL_BODY_STATUS.has(response.status)) {
      release()
      return response
    }
    watchdog.activity()
    const reader = response.body.getReader()
    const tapped = new ReadableStream<Uint8Array>({
      async pull(sink) {
        let next: ReadableStreamReadResult<Uint8Array>
        try {
          next = await reader.read()
        } catch (err: unknown) {
          release()
          if (external?.aborted) {
            sink.error(abortError(external.reason))
            return
          }
          noteFailure(host)
          sink.error(silent ?? (err instanceof NetError ? err : new NetError(host, classify(err), { cause: err })))
          return
        }
        if (next.done) {
          release()
          sink.close()
          return
        }
        watchdog.activity()
        sink.enqueue(next.value)
      },
      cancel(reason) {
        release()
        return reader.cancel(reason)
      },
    })
    return new Response(tapped, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

export const adaptiveFetch: FetchLike = createAdaptiveFetch()

export async function readBody(
  response: Response,
  onChunk?: (received: number) => void,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = response.body.getReader()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      chunks.push(next.value)
      received += next.value.byteLength
      onChunk?.(received)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError(signal?.reason))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export type RaceAttempt<T> = {
  host: string
  run: (signal: AbortSignal) => Promise<T>
}

export type RaceFailure = { host: string; error: unknown }

// Why a failed attempt may be worth repeating: the host answered that it is busy, or
// the connection broke before any answer arrived. A host that stayed silent through
// its whole backoff has already had that patience, so it is not asked again.
export type Temporary = 'busy' | 'broken'

export function temporaryFailure(err: unknown): Temporary | null {
  if (err instanceof NetError) return err.failure === 'no-response' || err.failure === 'stalled' ? null : 'broken'
  if (err && typeof err === 'object' && (err as { busy?: unknown }).busy === true) return 'busy'
  return null
}

export class RaceError extends Error {
  readonly failures: RaceFailure[]
  constructor(failures: RaceFailure[]) {
    super(failures.length
      ? failures.map(failure => `${failure.host}: ${failureWords(failure.error)}`).join('; ')
      : 'no source was available')
    this.name = 'RaceError'
    this.failures = failures
  }
}

export class DefinitiveError extends Error {
  constructor(readonly inner: unknown) {
    super(inner instanceof Error ? inner.message : String(inner))
    this.name = 'DefinitiveError'
  }
}

export function failureWords(err: unknown): string {
  if (err instanceof NetError) return err.words
  if (err && typeof err === 'object' && typeof (err as { words?: unknown }).words === 'string') return (err as { words: string }).words
  return err instanceof Error ? err.message : String(err)
}

export type Race<T> = {
  add: (attempt: RaceAttempt<T>) => void
  close: () => void
  result: Promise<T>
}

// Runs attempts in order. The next one starts when every attempt in flight has outlived
// its host's learned bound, or when one fails. A broken connection is tried once more
// after that bound, and a busy host is asked again with the bound doubling up to the
// backoff ceiling. The first success ends the race and aborts the rest.
export function createRace<T>(signal?: AbortSignal): Race<T> {
  type Entry = {
    attempt: RaceAttempt<T>
    ready: boolean
    backoff: number
    repeated: boolean
    timer?: ReturnType<typeof setTimeout>
  }
  type Flight = { controller: AbortController; overdue: boolean; hedge?: ReturnType<typeof setTimeout> }

  const waiting: Entry[] = []
  const flying = new Map<Entry, Flight>()
  const failures = new Map<string, unknown>()
  let closed = false
  let settled = false
  let resolveResult!: (value: T) => void
  let rejectResult!: (err: unknown) => void
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  const finish = (settle: () => void): void => {
    if (settled) return
    settled = true
    for (const flight of flying.values()) {
      if (flight.hedge) clearTimeout(flight.hedge)
      flight.controller.abort(abortError())
    }
    flying.clear()
    for (const entry of waiting) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    waiting.length = 0
    signal?.removeEventListener('abort', onAbort)
    settle()
  }
  const onAbort = (): void => finish(() => rejectResult(abortError(signal?.reason)))
  if (signal?.aborted) {
    settled = true
    rejectResult(abortError(signal.reason))
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }

  const repeatDelay = (entry: Entry, err: unknown): number | null => {
    const kind = temporaryFailure(err)
    if (kind === 'broken') {
      if (entry.repeated) return null
      entry.repeated = true
      return rto(entry.attempt.host)
    }
    if (kind === 'busy') {
      const next = entry.backoff ? entry.backoff * 2 : rto(entry.attempt.host)
      if (!withinBackoffCeiling(next * 2)) return null
      entry.backoff = next
      return next
    }
    return null
  }

  const everyFlightOverdue = (): boolean => {
    for (const flight of flying.values()) {
      if (!flight.overdue) return false
    }
    return true
  }

  const pump = (): void => {
    if (settled) return
    while (everyFlightOverdue()) {
      const index = waiting.findIndex(entry => entry.ready)
      if (index === -1) break
      launch(waiting.splice(index, 1)[0]!)
    }
    if (!settled && closed && waiting.length === 0 && flying.size === 0) {
      finish(() => rejectResult(new RaceError([...failures].map(([host, error]) => ({ host, error })))))
    }
  }

  const launch = (entry: Entry): void => {
    const flight: Flight = { controller: new AbortController(), overdue: false }
    flying.set(entry, flight)
    flight.hedge = setTimeout(() => {
      flight.overdue = true
      pump()
    }, rto(entry.attempt.host))
    flight.hedge.unref?.()
    let run: Promise<T>
    try {
      run = entry.attempt.run(flight.controller.signal)
    } catch (err: unknown) {
      run = Promise.reject(err)
    }
    run.then(
      value => finish(() => resolveResult(value)),
      (err: unknown) => {
        if (flight.hedge) clearTimeout(flight.hedge)
        flying.delete(entry)
        if (settled) return
        if (err instanceof DefinitiveError) {
          finish(() => rejectResult(err.inner))
          return
        }
        failures.set(entry.attempt.host, err)
        const delay = repeatDelay(entry, err)
        if (delay !== null) {
          entry.ready = false
          entry.timer = setTimeout(() => {
            entry.ready = true
            pump()
          }, delay)
          waiting.push(entry)
        }
        pump()
      },
    )
  }

  return {
    add(attempt) {
      if (settled) return
      waiting.push({ attempt, ready: true, backoff: 0, repeated: false })
      pump()
    },
    close() {
      closed = true
      pump()
    },
    result,
  }
}
