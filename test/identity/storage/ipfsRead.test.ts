import test from 'node:test'
import assert from 'node:assert/strict'
import { importBytes } from 'ipfs-unixfs-importer'
import { fixedSize } from 'ipfs-unixfs-importer/chunker'
import type { CID } from 'multiformats/cid'
import {
  IpfsReadError,
  multiaddrToGatewayBase,
  probeIpfs,
  readIpfs,
  resetIpfsDiscoveryForTest,
  type IpfsReadProgress,
} from '../../../src/identity/storage/ipfsRead.js'
import { isAbortError, resetHostStatsForTest, type FetchLike } from '../../../src/net/adaptive.js'
import { rawCid } from '../../support/home.js'
import { advance, flush, track } from '../../support/time.js'

type GatewayRequest = { cid: string; raw: boolean; signal: AbortSignal | undefined }
type Gateway = (request: GatewayRequest) => Response | Promise<Response>
type Router = (cid: string) => Response
type Asked = { host: string; path: string; accept: string | null }

const notFound = (): Response => new Response('not found', { status: 404 })

function networkError(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code }) })
}

// Stands in for the IPFS network: named gateways and routers, with every request
// recorded. A host nobody defined answers 404, like a gateway without the content.
function net(gateways: Record<string, Gateway>, routers: Record<string, Router> = {}) {
  const asked: Asked[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input))
    asked.push({ host: url.host, path: url.pathname + url.search, accept: new Headers(init?.headers).get('accept') })
    if (url.pathname.startsWith('/routing/v1/providers/')) {
      return routers[url.host]?.(url.pathname.split('/').pop() ?? '') ?? notFound()
    }
    const gateway = gateways[url.host]
    if (!gateway) return notFound()
    return gateway({
      cid: decodeURIComponent(url.pathname.slice('/ipfs/'.length)),
      raw: url.searchParams.get('format') === 'raw',
      signal: init?.signal ?? undefined,
    })
  }
  return { asked, fetchImpl, gatewayCalls: () => asked.filter(call => call.path.startsWith('/ipfs/')) }
}

const serve = (objects: Map<string, Uint8Array>): Gateway => ({ cid }) => {
  const bytes = objects.get(cid)
  return bytes ? new Response(Buffer.from(bytes)) : notFound()
}

type BuiltFile = { root: string; blocks: Map<string, Uint8Array>; leaves: string[] }

async function buildFile(data: Uint8Array, chunkSize = 1024): Promise<BuiltFile> {
  const blocks = new Map<string, Uint8Array>()
  const blockstore = {
    async put(cid: CID, bytes: Uint8Array): Promise<CID> {
      blocks.set(cid.toString(), bytes)
      return cid
    },
  }
  const entry = await importBytes(data, blockstore as unknown as Parameters<typeof importBytes>[1], {
    cidVersion: 1,
    rawLeaves: true,
    chunker: fixedSize({ chunkSize }),
  })
  const root = entry.cid.toString()
  return { root, blocks, leaves: [...blocks.keys()].filter(cid => cid !== root) }
}

// A gateway that speaks the trustless block format. `whole` is what it returns for the
// root on a plain path, the way an ordinary gateway serves a file.
function blockGateway(file: BuiltFile, options: { whole?: Uint8Array; swap?: Map<string, Uint8Array> } = {}): Gateway {
  return ({ cid, raw }) => {
    if (!raw && cid === file.root) return options.whole ? new Response(Buffer.from(options.whole)) : notFound()
    const block = options.swap?.get(cid) ?? file.blocks.get(cid)
    return block ? new Response(Buffer.from(block)) : notFound()
  }
}

async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map(Object.keys(vars).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function fresh(): void {
  resetHostStatsForTest()
  resetIpfsDiscoveryForTest()
}

const sample = (length: number): Uint8Array => new Uint8Array(length).map((_, index) => (index * 31 + 7) % 251)

test('gateway addresses from content routing become https origins, and only those', () => {
  assert.equal(multiaddrToGatewayBase('/dns/gateway-v3.pinata.cloud/tcp/443/https'), 'https://gateway-v3.pinata.cloud')
  assert.equal(multiaddrToGatewayBase('/dns4/blocks.example/tcp/8443/tls/http'), 'https://blocks.example:8443')
  assert.equal(multiaddrToGatewayBase('/ip6/::1/tcp/443/https'), 'https://[::1]')
  assert.equal(multiaddrToGatewayBase('/dns/plain.example/tcp/80/http'), null, 'no TLS, no source')
  assert.equal(multiaddrToGatewayBase('/ip4/203.0.113.9/tcp/4001/p2p/12D3KooW'), null, 'a libp2p peer is not a gateway')
})

test('a single-block file comes from the first gateway as a plain path and its hash is checked', async () => {
  fresh()
  const bytes = new TextEncoder().encode('{"name":"agent"}')
  const cid = rawCid(bytes)
  const { fetchImpl, gatewayCalls } = net({ 'ipfs.filebase.io': serve(new Map([[cid, bytes]])) })
  const progress: IpfsReadProgress[] = []
  const out = await readIpfs(cid, { fetchImpl, onProgress: event => progress.push(event) })
  assert.deepEqual(Buffer.from(out), Buffer.from(bytes))
  assert.deepEqual(gatewayCalls(), [{ host: 'ipfs.filebase.io', path: `/ipfs/${cid}`, accept: null }])
  assert.deepEqual(progress, [{ bytes: bytes.byteLength, total: bytes.byteLength, host: 'ipfs.filebase.io' }])
})

test('PINATA_GATEWAY_URL is asked before every other source', async () => {
  fresh()
  const bytes = new TextEncoder().encode('dedicated')
  const cid = rawCid(bytes)
  const { fetchImpl, gatewayCalls } = net({ 'mine.mypinata.cloud': serve(new Map([[cid, bytes]])) })
  await withEnv({ PINATA_GATEWAY_URL: 'https://mine.mypinata.cloud/' }, async () => {
    await readIpfs(cid, { fetchImpl })
  })
  assert.deepEqual(gatewayCalls().map(call => call.host), ['mine.mypinata.cloud'])
})

test('a gateway that lacks the file, or cannot be reached, hands over to the next', async () => {
  const bytes = new TextEncoder().encode('second source')
  const cid = rawCid(bytes)
  const misses: Gateway[] = [notFound, async () => { throw networkError('ECONNRESET') }, () => new Response('slow down', { status: 429 })]
  for (const miss of misses) {
    fresh()
    const { fetchImpl, gatewayCalls } = net({
      'ipfs.filebase.io': miss,
      'gateway.pinata.cloud': serve(new Map([[cid, bytes]])),
    })
    assert.deepEqual(Buffer.from(await readIpfs(cid, { fetchImpl })), Buffer.from(bytes))
    assert.deepEqual(gatewayCalls().map(call => call.host), ['ipfs.filebase.io', 'gateway.pinata.cloud'])
  }
})

test('wrong bytes are refused and the next gateway is asked', async () => {
  fresh()
  const bytes = new TextEncoder().encode('{"real":true}')
  const cid = rawCid(bytes)
  const { fetchImpl, gatewayCalls } = net({
    'ipfs.filebase.io': serve(new Map([[cid, new TextEncoder().encode('{"real":fals}')]])),
    'gateway.pinata.cloud': serve(new Map([[cid, bytes]])),
  })
  assert.deepEqual(Buffer.from(await readIpfs(cid, { fetchImpl })), Buffer.from(bytes))
  assert.deepEqual(gatewayCalls().map(call => call.host), ['ipfs.filebase.io', 'gateway.pinata.cloud'])
})

test('when no source returns the file, the error names every source and what it did', async () => {
  fresh()
  const bytes = new TextEncoder().encode('{"real":true}')
  const cid = rawCid(bytes)
  const { fetchImpl } = net({
    'ipfs.filebase.io': serve(new Map([[cid, new TextEncoder().encode('tampered')]])),
    'gateway.pinata.cloud': notFound,
    'dweb.link': () => new Response('upstream', { status: 504 }),
  })
  const err = await readIpfs(cid, { fetchImpl }).then(() => null, (reason: unknown) => reason)
  assert.ok(err instanceof IpfsReadError)
  assert.equal(err.cid, cid)
  assert.deepEqual(err.outcomes, [
    { host: 'ipfs.filebase.io', outcome: 'returned the wrong bytes' },
    { host: 'gateway.pinata.cloud', outcome: 'not found' },
    { host: 'dweb.link', outcome: 'server error' },
  ])
  assert.equal(
    err.message,
    `No IPFS source returned ${cid.slice(0, 10)}…${cid.slice(-6)}: ipfs.filebase.io returned the wrong bytes, gateway.pinata.cloud not found, dweb.link server error.`,
  )
})

test('ETHAGENT_IPFS_GATEWAYS replaces the built-in gateways, and an empty list means none', async () => {
  fresh()
  const bytes = new TextEncoder().encode('custom')
  const cid = rawCid(bytes)
  const custom = net({ 'two.example': serve(new Map([[cid, bytes]])) })
  await withEnv({ ETHAGENT_IPFS_GATEWAYS: 'https://one.example/, two.example', ETHAGENT_IPFS_ROUTERS: '' }, async () => {
    await readIpfs(cid, { fetchImpl: custom.fetchImpl })
  })
  assert.deepEqual(custom.asked.map(call => call.host), ['one.example', 'two.example'], 'no built-in gateway and no router was contacted')

  fresh()
  const none = net({})
  await withEnv({ ETHAGENT_IPFS_GATEWAYS: '', ETHAGENT_IPFS_ROUTERS: '' }, async () => {
    const err = await readIpfs(cid, { fetchImpl: none.fetchImpl }).then(() => null, (reason: unknown) => reason)
    assert.ok(err instanceof IpfsReadError)
    assert.match(err.message, /^No IPFS source was available for /)
  })
  assert.equal(none.asked.length, 0)
})

test('content routing finds a source the built-in gateways do not have', async () => {
  fresh()
  const bytes = new TextEncoder().encode('only on the discovered gateway')
  const cid = rawCid(bytes)
  const { asked, fetchImpl } = net(
    { 'trustless.example': serve(new Map([[cid, bytes]])) },
    {
      'delegated-ipfs.dev': () => Response.json({
        Providers: [
          { Schema: 'peer', Protocols: ['transport-bitswap'], Addrs: ['/ip4/203.0.113.9/tcp/4001'] },
          { Schema: 'peer', Protocols: ['transport-ipfs-gateway-http'], Addrs: ['/dns/trustless.example/tcp/443/https'] },
        ],
      }),
    },
  )
  assert.deepEqual(Buffer.from(await readIpfs(cid, { fetchImpl })), Buffer.from(bytes))
  assert.ok(asked.some(call => call.host === 'delegated-ipfs.dev' && call.path === `/routing/v1/providers/${cid}`))
  assert.deepEqual(
    asked.filter(call => call.host === 'trustless.example'),
    [{ host: 'trustless.example', path: `/ipfs/${cid}?format=raw`, accept: 'application/vnd.ipld.raw' }],
    'a discovered source is asked for the verifiable raw block',
  )
})

test('a dead router costs nothing when a gateway has the file, and none is asked when routers are off', async () => {
  fresh()
  const bytes = new TextEncoder().encode('gateway has it')
  const cid = rawCid(bytes)
  const dead = net({ 'ipfs.filebase.io': serve(new Map([[cid, bytes]])) }, {
    'delegated-ipfs.dev': () => { throw networkError('ENOTFOUND') },
  })
  assert.deepEqual(Buffer.from(await readIpfs(cid, { fetchImpl: dead.fetchImpl })), Buffer.from(bytes))

  fresh()
  const off = net({ 'ipfs.filebase.io': serve(new Map([[cid, bytes]])) })
  await withEnv({ ETHAGENT_IPFS_ROUTERS: '' }, async () => {
    await readIpfs(cid, { fetchImpl: off.fetchImpl })
  })
  assert.ok(!off.asked.some(call => call.path.startsWith('/routing/')))
})

test('a multi-block file is rebuilt from blocks that each pass their hash', async () => {
  fresh()
  const data = sample(5_000)
  const file = await buildFile(data)
  assert.equal(file.leaves.length, 5, 'the fixture really spans several blocks')
  const { fetchImpl, gatewayCalls } = net({ 'ipfs.filebase.io': blockGateway(file) })
  const progress: IpfsReadProgress[] = []
  const out = await readIpfs(file.root, { fetchImpl, onProgress: event => progress.push(event) })
  assert.deepEqual(Buffer.from(out), Buffer.from(data))
  assert.deepEqual(
    gatewayCalls().find(call => call.path.startsWith(`/ipfs/${file.root}`)),
    { host: 'ipfs.filebase.io', path: `/ipfs/${file.root}?format=raw`, accept: 'application/vnd.ipld.raw' },
    'the root is fetched as a raw block, never as an unverifiable whole file',
  )
  assert.deepEqual(new Set(gatewayCalls().map(call => call.path.split('?')[0])), new Set([file.root, ...file.leaves].map(cid => `/ipfs/${cid}`)))
  assert.deepEqual(progress.at(-1), { bytes: 5_000, total: 5_000, host: 'ipfs.filebase.io' })
  assert.ok(progress.every((event, index) => index === 0 || event.bytes > progress[index - 1]!.bytes), 'progress only moves forward')
})

test('a tampered block is refused and that block alone comes from another source', async () => {
  fresh()
  const data = sample(5_000)
  const file = await buildFile(data)
  const target = file.leaves[2]!
  const tampered = Uint8Array.from(file.blocks.get(target)!, byte => byte ^ 0xff)
  const { fetchImpl, gatewayCalls } = net({
    'ipfs.filebase.io': blockGateway(file, { swap: new Map([[target, tampered]]) }),
    'gateway.pinata.cloud': blockGateway(file),
  })
  const out = await readIpfs(file.root, { fetchImpl })
  assert.deepEqual(Buffer.from(out), Buffer.from(data), 'the tampered bytes never reach the result')
  assert.deepEqual(
    gatewayCalls().filter(call => call.host === 'gateway.pinata.cloud').map(call => call.path.split('?')[0]),
    [`/ipfs/${target}`],
  )
})

test('a gateway that only serves whole files still delivers a multi-block file', async () => {
  fresh()
  const data = sample(5_000)
  const file = await buildFile(data)
  // Ignores ?format=raw and always answers with the assembled file, like a plain path gateway.
  const wholeOnly: Gateway = ({ cid }) => cid === file.root ? new Response(Buffer.from(data)) : notFound()
  const { fetchImpl } = net({ 'gateway.pinata.cloud': wholeOnly })
  const out = await readIpfs(file.root, { fetchImpl })
  assert.deepEqual(Buffer.from(out), Buffer.from(data))
})

test('cancelling a download rejects as cancelled, not as a failed download', async () => {
  fresh()
  const bytes = new TextEncoder().encode('never arrives')
  const cid = rawCid(bytes)
  const hang: Gateway = ({ signal }) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const { fetchImpl } = net({ 'ipfs.filebase.io': hang, 'gateway.pinata.cloud': hang, 'dweb.link': hang })
  const controller = new AbortController()
  const reading = readIpfs(cid, { fetchImpl, signal: controller.signal })
  await flush()
  controller.abort()
  const err = await reading.then(() => null, (reason: unknown) => reason)
  assert.ok(isAbortError(err))
  assert.ok(!(err instanceof IpfsReadError))
})

test('a name that is not a CID is fetched as a plain path without content routing', async () => {
  fresh()
  const { asked, fetchImpl } = net({ 'ipfs.filebase.io': serve(new Map([['bafy-legacy-name', new TextEncoder().encode('legacy')]])) })
  const out = await readIpfs('bafy-legacy-name', { fetchImpl })
  assert.equal(new TextDecoder().decode(out), 'legacy')
  assert.deepEqual(asked, [{ host: 'ipfs.filebase.io', path: '/ipfs/bafy-legacy-name', accept: null }])
})

test('a probe answers whether any source can serve the first block', async () => {
  fresh()
  const data = sample(3_000)
  const file = await buildFile(data)
  const present = net({ 'dweb.link': blockGateway(file) })
  assert.equal(await probeIpfs(file.root, { fetchImpl: present.fetchImpl }), true)
  assert.ok(!present.gatewayCalls().some(call => file.leaves.some(leaf => call.path.includes(leaf))), 'one block is enough to know')

  fresh()
  assert.equal(await probeIpfs(file.root, { fetchImpl: net({}).fetchImpl }), false)
})

test('a rate-limited gateway is asked again after its bound instead of failing the download', async t => {
  fresh()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const bytes = new TextEncoder().encode('worth the wait')
  const cid = rawCid(bytes)
  let asks = 0
  const { fetchImpl } = net({
    'only.example': () => {
      asks += 1
      return asks === 1 ? new Response('slow down', { status: 429 }) : new Response(Buffer.from(bytes))
    },
  })
  await withEnv({ ETHAGENT_IPFS_GATEWAYS: 'https://only.example', ETHAGENT_IPFS_ROUTERS: '' }, async () => {
    const reading = track(readIpfs(cid, { fetchImpl }))
    await flush()
    await advance(t, 750)
    assert.equal(reading.settled, false)
    await advance(t, 250)
    assert.equal(reading.settled, true)
    assert.equal(reading.error, undefined)
    assert.equal(asks, 2)
  })
})
