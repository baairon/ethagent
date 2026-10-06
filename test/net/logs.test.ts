import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicClient, parseAbiItem, type PublicClient } from 'viem'
import { base } from 'viem/chains'
import { createAdaptiveFetch, learnedLogRange, resetHostStatsForTest } from '../../src/net/adaptive.js'
import { adaptiveRpcTransport } from '../../src/net/rpc.js'
import { classifyLogQueryError, LogScanError, scanLogs } from '../../src/net/logs.js'

const BASE_ORG = 'https://mainnet.base.org'
const PUBLICNODE = 'https://base.publicnode.com'
const ARCHIVE = 'https://archive.example'
const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

// Learned ranges live in the shared host table; later tests must not inherit them.
afterEach(() => resetHostStatsForTest())

type Span = { from: bigint; to: bigint }

// Endpoints that behave like the public Base ones: mainnet.base.org refuses more than
// 500 blocks per query with -32614 (or HTTP 413), publicnode refuses history older than
// a day with -32602, and the archive serves anything.
function chain(opts: { http413?: boolean } = {}) {
  const asked: Array<{ host: string } & Span> = []
  const fetchImpl = createAdaptiveFetch(async (input, init) => {
    const host = new URL(String(input)).host
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: Array<{ fromBlock: string; toBlock: string }> }
    const from = BigInt(request.params[0]!.fromBlock)
    const to = BigInt(request.params[0]!.toBlock)
    asked.push({ host, from, to })
    const reply = (body: unknown) => Response.json({ jsonrpc: '2.0', id: request.id, ...body as object })
    if (host === 'mainnet.base.org' && to - from + 1n > 500n) {
      if (opts.http413) return new Response('too large', { status: 413 })
      return reply({ error: { code: -32614, message: 'eth_getLogs is limited to a 500 range' } })
    }
    if (host === 'base.publicnode.com' && from < 9_000n) {
      return reply({ error: { code: -32602, message: 'state histories older than 24 hours are not available' } })
    }
    const logs = from <= 1_234n && 1_234n <= to
      ? [{
          address: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            '0x000000000000000000000000000000000000000000000000000000000000dead',
            '0x000000000000000000000000000000000000000000000000000000000000b2b0',
          ],
          data: '0x',
          blockNumber: '0x4d2',
          transactionHash: '0x' + '11'.repeat(32),
          transactionIndex: '0x0',
          blockHash: '0x' + '22'.repeat(32),
          logIndex: '0x0',
          removed: false,
        }]
      : []
    return reply({ result: logs })
  })
  const clients = new Map<string, PublicClient>()
  const query = async (url: string, fromBlock: bigint, toBlock: bigint) => {
    let client = clients.get(url)
    if (!client) {
      client = createPublicClient({ chain: base, transport: adaptiveRpcTransport([url], fetchImpl) }) as PublicClient
      clients.set(url, client)
    }
    return client.getLogs({ event: TRANSFER, fromBlock, toBlock })
  }
  return { asked, query }
}

async function collect<T>(gen: AsyncGenerator<T[]>): Promise<T[]> {
  const out: T[] = []
  for await (const chunk of gen) out.push(...chunk)
  return out
}

test('scanLogs takes the limit an endpoint names and remembers it for the host', async () => {
  resetHostStatsForTest()
  const net = chain()
  const logs = await collect(scanLogs({ urls: [BASE_ORG], fromBlock: 0n, toBlock: 1_999n, initialRange: 10_000n, query: net.query }))
  assert.equal(logs.length, 1)
  assert.equal(learnedLogRange('mainnet.base.org'), 500)
  const served = net.asked.filter(item => item.to - item.from + 1n <= 500n)
  assert.equal(served.length, 4)
  // A second scan starts from the learned range instead of being refused again.
  const before = net.asked.length
  await collect(scanLogs({ urls: [BASE_ORG], fromBlock: 0n, toBlock: 999n, initialRange: 10_000n, query: net.query }))
  assert.equal(net.asked.length - before, 2)
})

test('scanLogs halves on a range refusal that names no limit (HTTP 413)', async () => {
  resetHostStatsForTest()
  const net = chain({ http413: true })
  await collect(scanLogs({ urls: [BASE_ORG], fromBlock: 0n, toBlock: 1_999n, initialRange: 2_000n, query: net.query }))
  assert.equal(learnedLogRange('mainnet.base.org'), 500)
  assert.deepEqual(net.asked.slice(0, 3).map(item => item.to - item.from + 1n), [2_000n, 1_000n, 500n])
})

test('scanLogs hands over to the next endpoint when one refuses the depth of history', async () => {
  resetHostStatsForTest()
  const net = chain()
  const logs = await collect(scanLogs({ urls: [PUBLICNODE, ARCHIVE], fromBlock: 0n, toBlock: 9_999n, initialRange: 1_000n, query: net.query }))
  assert.equal(logs.length, 1)
  assert.ok(net.asked.some(item => item.host === 'base.publicnode.com'))
  assert.ok(net.asked.some(item => item.host === 'archive.example' && item.from === 0n))
})

test('scanLogs explains why when no endpoint can cover the span', async () => {
  resetHostStatsForTest()
  const net = chain()
  await assert.rejects(
    collect(scanLogs({ urls: [BASE_ORG, PUBLICNODE], fromBlock: 0n, toBlock: 999_999n, initialRange: 10_000n, query: net.query })),
    (err: unknown) => {
      assert.ok(err instanceof LogScanError)
      assert.match(err.message, /mainnet\.base\.org serves 500 blocks per query/)
      assert.match(err.message, /base\.publicnode\.com does not keep logs back to block/)
      assert.match(err.message, /set an RPC with history/)
      return true
    },
  )
})

test('classifyLogQueryError reads range limits and history refusals', () => {
  assert.deepEqual(classifyLogQueryError({ code: -32614, message: 'eth_getLogs is limited to a 500 range' }), { kind: 'range', limit: 500 })
  assert.deepEqual(classifyLogQueryError({ code: -32005, message: 'query returned more than 10000 results' }), { kind: 'range' })
  assert.deepEqual(classifyLogQueryError(new Error('No RPC endpoint answered (x: HTTP 413)')), { kind: 'range' })
  assert.deepEqual(classifyLogQueryError({ code: -32602, message: 'invalid block range params' }), { kind: 'range' })
  assert.deepEqual(classifyLogQueryError({ code: -32602, message: 'state histories older than 24 hours are not available' }), { kind: 'history' })
  assert.deepEqual(classifyLogQueryError(new Error('boom')), { kind: 'other' })
})
