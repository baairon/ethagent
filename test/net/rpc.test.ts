import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicClient, parseAbi } from 'viem'
import { base } from 'viem/chains'
import { createAdaptiveFetch, noteResponse, resetHostStatsForTest } from '../../src/net/adaptive.js'
import { adaptiveRpcTransport, RpcUnansweredError } from '../../src/net/rpc.js'
import { identityManagerErrorView } from '../../src/identity/manager/shared/model/errors.js'
import { advance, flush, track } from '../support/time.js'

const A = 'https://rpc-a.example'
const B = 'https://rpc-b.example'

type Reply =
  | { result: unknown }
  | { error: { code: number; message: string; data?: unknown } }
  | { http: number }
  | { text: string }
  | { network: string }

type Handler = (request: { method: string; params: unknown[] }, nth: number) => Reply

// Stands in for the RPC endpoints: each host answers through its handler, and every
// request is recorded so a test can see who was asked, and how often.
function endpoints(handlers: Record<string, Handler>) {
  const asked: Array<{ host: string; method: string }> = []
  const counts = new Map<string, number>()
  const fetchImpl = createAdaptiveFetch(async (input, init) => {
    const host = new URL(String(input)).host
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    asked.push({ host, method: request.method })
    const nth = (counts.get(host) ?? 0) + 1
    counts.set(host, nth)
    const reply = handlers[host]!(request, nth)
    if ('network' in reply) {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code: reply.network }) })
    }
    if ('http' in reply) return new Response('unavailable', { status: reply.http })
    if ('text' in reply) return new Response(reply.text, { status: 200 })
    return Response.json({ jsonrpc: '2.0', id: request.id, ...reply })
  })
  const client = createPublicClient({ chain: base, transport: adaptiveRpcTransport([A, B], fetchImpl) })
  const ask = (method: string, params: unknown[] = []): Promise<unknown> =>
    client.request({ method, params } as never)
  return { asked, client, ask, timesAsked: (host: string) => counts.get(host) ?? 0 }
}

function causeChain(err: unknown): Array<{ name?: string; code?: number; data?: unknown; message?: string }> {
  const chain: Array<{ name?: string; code?: number; data?: unknown; message?: string }> = []
  for (let current = err; current && chain.length < 8; current = (current as { cause?: unknown }).cause) {
    chain.push(current as { name?: string; code?: number; data?: unknown; message?: string })
  }
  return chain
}

test('rpc: the first endpoint to answer wins and the second is never asked', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': () => ({ result: '0x10' }),
    'rpc-b.example': () => ({ result: '0x99' }),
  })
  assert.equal(await net.ask('eth_blockNumber'), '0x10')
  assert.deepEqual(net.asked, [{ host: 'rpc-a.example', method: 'eth_blockNumber' }])
})

test('rpc: a rate-limited, dead, or garbled endpoint hands over to the next one at once', async () => {
  for (const failure of [{ http: 429 }, { network: 'ECONNRESET' }, { text: '<html>blocked</html>' }] as Reply[]) {
    resetHostStatsForTest()
    const net = endpoints({
      'rpc-a.example': () => failure,
      'rpc-b.example': () => ({ result: '0x2a' }),
    })
    assert.equal(await net.ask('eth_blockNumber'), '0x2a')
    assert.deepEqual(net.asked.map(call => call.host), ['rpc-a.example', 'rpc-b.example'])
  }
})

test('rpc: the configured endpoint stays first while it is healthy, even when a fallback is faster', async () => {
  resetHostStatsForTest()
  noteResponse('rpc-a.example', 900)
  noteResponse('rpc-b.example', 20)
  const net = endpoints({
    'rpc-a.example': () => ({ result: '0xa' }),
    'rpc-b.example': () => ({ result: '0xb' }),
  })
  assert.equal(await net.ask('eth_blockNumber'), '0xa')
  assert.deepEqual(net.asked.map(call => call.host), ['rpc-a.example'])
})

test('rpc: a healthy endpoint is asked first next time', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': () => ({ network: 'ECONNRESET' }),
    'rpc-b.example': () => ({ result: '0x1' }),
  })
  await net.ask('eth_blockNumber')
  net.asked.length = 0
  await net.ask('eth_blockNumber')
  assert.deepEqual(net.asked.map(call => call.host), ['rpc-b.example'], 'the endpoint that failed moved to the back')
})

test('rpc: a revert is the chain\'s verdict, so no other endpoint is asked', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': () => ({ error: { code: 3, message: 'execution reverted: not the owner', data: '0x08c379a0' } }),
    'rpc-b.example': () => ({ result: '0x' }),
  })
  const err = await net.ask('eth_call', [{}, 'latest']).then(() => null, (reason: unknown) => reason)
  const verdict = causeChain(err).find(link => link.code === 3)
  assert.ok(verdict, 'the revert reaches the caller with its code')
  assert.equal(verdict.data, '0x08c379a0')
  assert.deepEqual(net.asked.map(call => call.host), ['rpc-a.example'])
})

test('rpc: viem turns a revert through the transport into its contract error', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': () => ({ error: { code: 3, message: 'execution reverted', data: '0x' } }),
    'rpc-b.example': () => ({ result: '0x' }),
  })
  await assert.rejects(
    net.client.readContract({
      address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      abi: parseAbi(['function ownerOf(uint256 tokenId) view returns (address)']),
      functionName: 'ownerOf',
      args: [1n],
    }),
    (err: unknown) => (err as Error).name === 'ContractFunctionExecutionError',
  )
})

test('rpc: an endpoint\'s own error is reported when no endpoint does better, without waiting', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const net = endpoints({
    'rpc-a.example': () => ({ error: { code: -32602, message: 'invalid argument 0: hex string without 0x prefix' } }),
    'rpc-b.example': () => ({ error: { code: -32602, message: 'invalid argument 0: hex string without 0x prefix' } }),
  })
  const err = await net.ask('eth_getBalance', ['nope']).then(() => null, (reason: unknown) => reason)
  assert.ok(causeChain(err).some(link => link.code === -32602), 'the JSON-RPC error keeps its code')
  assert.equal(net.timesAsked('rpc-a.example'), 1)
  assert.equal(net.timesAsked('rpc-b.example'), 1)
})

test('rpc: a size limit is not mistaken for a busy endpoint', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const tooMany = { error: { code: -32005, message: 'query returned more than 10000 results' } }
  const net = endpoints({ 'rpc-a.example': () => tooMany, 'rpc-b.example': () => tooMany })
  const err = await net.ask('eth_getLogs', [{}]).then(() => null, (reason: unknown) => reason)
  assert.ok(causeChain(err).some(link => link.code === -32005))
  assert.equal(net.timesAsked('rpc-a.example') + net.timesAsked('rpc-b.example'), 2, 'the caller narrows the range instead')
})

test('rpc: endpoints that are behind or rate limited are asked again after their bound', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const net = endpoints({
    'rpc-a.example': (_request, nth) => nth === 1 ? { error: { code: -32000, message: 'header not found' } } : { result: '0x7' },
    'rpc-b.example': (_request, nth) => nth === 1 ? { http: 429 } : { result: '0x7' },
  })
  const pending = track(net.ask('eth_getBlockByNumber', ['0x7', false]))
  await flush()
  await advance(t, 750)
  assert.equal(pending.settled, false, 'both endpoints asked for time, so the request waits')
  assert.equal(net.asked.length, 2)
  await advance(t, 250)
  assert.equal(pending.settled, true)
  assert.equal(pending.error, undefined)
  assert.equal(net.asked.length, 3, 'one more ask was enough')
})

test('rpc: a persistently busy endpoint is given up on when the backoff reaches its ceiling', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const net = endpoints({
    'rpc-a.example': () => ({ http: 429 }),
    'rpc-b.example': () => ({ http: 429 }),
  })
  const pending = track(net.ask('eth_blockNumber'))
  await flush()
  await advance(t, 30_750)
  assert.equal(pending.settled, false)
  await advance(t, 250)
  assert.equal(pending.settled, true)
  assert.ok(causeChain(pending.error).some(link => link instanceof RpcUnansweredError))
  assert.equal(net.timesAsked('rpc-a.example'), 6, 'waits of 1, 2, 4, 8 and 16 seconds, then no more')
})

test('rpc: when nothing answers, the error names each endpoint and what it did', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const net = endpoints({
    'rpc-a.example': () => ({ network: 'ECONNRESET' }),
    'rpc-b.example': () => ({ network: 'ENOTFOUND' }),
  })
  const pending = track(net.ask('eth_blockNumber'))
  await flush()
  assert.equal(pending.settled, false, 'a broken connection gets one more try')
  await advance(t, 1_000)
  assert.equal(pending.settled, true)
  const unanswered = causeChain(pending.error).find(link => link instanceof RpcUnansweredError) as RpcUnansweredError | undefined
  assert.ok(unanswered)
  assert.deepEqual(unanswered.outcomes, [
    { host: 'rpc-a.example', outcome: 'connection reset' },
    { host: 'rpc-b.example', outcome: 'DNS lookup failed' },
  ])
  assert.equal(net.timesAsked('rpc-a.example'), 2)
  assert.equal(net.timesAsked('rpc-b.example'), 2)

  assert.deepEqual(identityManagerErrorView(pending.error), {
    title: 'Chain Connection Failed',
    detail: 'No RPC endpoint answered.\nrpc-a.example: connection reset\nrpc-b.example: DNS lookup failed',
    hint: 'If a VPN is on, switch servers or pause it, then try again.',
  })
})

test('rpc: a pending receipt is an answer, not a failure', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': () => ({ result: null }),
    'rpc-b.example': () => ({ result: '0x1' }),
  })
  assert.equal(await net.ask('eth_getTransactionReceipt', ['0xabc']), null)
  assert.equal(net.asked.length, 1)
})

test('rpc: a broadcast goes to exactly one endpoint and is never repeated', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const net = endpoints({
    'rpc-a.example': () => ({ network: 'ECONNRESET' }),
    'rpc-b.example': () => ({ result: '0xhash' }),
  })
  const pending = track(net.ask('eth_sendRawTransaction', ['0x02']))
  await advance(t, 5_000)
  assert.equal(pending.settled, true)
  assert.ok(causeChain(pending.error).some(link => link instanceof RpcUnansweredError))
  assert.deepEqual(net.asked, [{ host: 'rpc-a.example', method: 'eth_sendRawTransaction' }])
})

test('rpc: viem reads through the transport', async () => {
  resetHostStatsForTest()
  const net = endpoints({
    'rpc-a.example': request => request.method === 'eth_blockNumber' ? { result: '0x10' } : { result: '0x' },
    'rpc-b.example': () => ({ result: '0x0' }),
  })
  assert.equal(await net.client.getBlockNumber(), 16n)
})
