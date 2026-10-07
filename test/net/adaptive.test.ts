import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createAdaptiveFetch,
  createRace,
  DefinitiveError,
  isAbortError,
  NetError,
  noteFailure,
  noteResponse,
  RaceError,
  rankUrls,
  readBody,
  resetHostStatsForTest,
  rto,
  temporaryFailure,
  type FetchLike,
  type RaceAttempt,
} from '../../src/net/adaptive.js'
import { advance, flush, track } from '../support/time.js'

// A request that only ever ends when it is aborted, the way a black-holed socket does.
const hangUntilAborted: FetchLike = (_input, init) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
})

function networkError(code?: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), code ? { code } : {}) })
}

test('an unseen host starts from the initial retransmission timeout', () => {
  resetHostStatsForTest()
  assert.equal(rto('unseen.example'), 1_000)
})

test('the timeout follows what a host has shown: smoothed latency plus four deviations', () => {
  resetHostStatsForTest()
  noteResponse('measured.example', 2_000)
  assert.equal(rto('measured.example'), 6_000, 'first sample: srtt 2000, rttvar 1000')
  noteResponse('measured.example', 2_000)
  assert.equal(rto('measured.example'), 5_000, 'a steady host tightens its own bound')
  noteResponse('measured.example', 4_000)
  assert.equal(rto('measured.example'), 6_500, 'a slow answer widens it again')
})

test('the timeout never drops under the floor or passes the backoff ceiling', () => {
  resetHostStatsForTest()
  noteResponse('quick.example', 40)
  assert.equal(rto('quick.example'), 1_000)
  noteResponse('glacial.example', 500_000)
  assert.equal(rto('glacial.example'), 60_000)
})

test('sources are ranked by measured latency, unknown hosts at the initial estimate, failing hosts last', t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['Date'], now: 1_000 })
  noteResponse('fast.example', 100)
  noteResponse('slow.example', 3_000)
  noteFailure('down-first.example')
  t.mock.timers.tick(50)
  noteFailure('down-later.example')
  assert.deepEqual(
    rankUrls([
      'https://down-later.example',
      'https://slow.example',
      'https://down-first.example',
      'https://unknown.example',
      'https://fast.example',
    ]),
    [
      'https://fast.example',
      'https://unknown.example',
      'https://slow.example',
      'https://down-first.example',
      'https://down-later.example',
    ],
  )
})

test('one answer clears a host that was marked failing', () => {
  resetHostStatsForTest()
  noteFailure('recovering.example')
  assert.deepEqual(rankUrls(['https://recovering.example', 'https://steady.example']), ['https://steady.example', 'https://recovering.example'])
  noteResponse('recovering.example', 120)
  assert.deepEqual(rankUrls(['https://recovering.example', 'https://steady.example']), ['https://recovering.example', 'https://steady.example'])
})

test('host measurements persist to the machine-local file and a corrupt file just resets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-hosts-'))
  const file = path.join(dir, 'nested', 'hosts.json')
  process.env.ETHAGENT_HOSTS_FILE = file
  try {
    resetHostStatsForTest(true)
    noteResponse('remembered.example', 2_000)
    let saved: Record<string, { srtt?: number; samples?: number }> | null = null
    for (let attempt = 0; attempt < 400 && !saved; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
      saved = await fs.readFile(file, 'utf8').then(text => JSON.parse(text) as typeof saved, () => null)
    }
    assert.equal(saved?.['remembered.example']?.srtt, 2_000)
    assert.equal(saved?.['remembered.example']?.samples, 1)

    resetHostStatsForTest(true)
    assert.equal(rto('remembered.example'), 6_000, 'a new process starts from the saved measurements')

    await fs.writeFile(file, '{ not json')
    resetHostStatsForTest(true)
    assert.equal(rto('remembered.example'), 1_000, 'a corrupt cache is discarded, not fatal')
  } finally {
    process.env.ETHAGENT_HOSTS_FILE = ''
    resetHostStatsForTest()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('temp files a killed process left behind are swept on load; fresh ones are kept', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-hosts-'))
  const file = path.join(dir, 'hosts.json')
  const stale = `${file}.123.1.tmp`
  const fresh = `${file}.456.2.tmp`
  process.env.ETHAGENT_HOSTS_FILE = file
  try {
    await fs.writeFile(stale, '{}')
    await fs.writeFile(fresh, '{}')
    const old = new Date(Date.now() - 10 * 60_000)
    await fs.utimes(stale, old, old)
    resetHostStatsForTest(true)
    rto('any.example')
    await assert.rejects(fs.access(stale))
    await fs.access(fresh)
  } finally {
    process.env.ETHAGENT_HOSTS_FILE = ''
    resetHostStatsForTest()
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a host that never answers is dropped only after its backoff passes the ceiling', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const request = track(createAdaptiveFetch(hangUntilAborted)('https://silent.example/data'))
  await advance(t, 62_750)
  t.mock.timers.tick(249)
  await flush()
  assert.equal(request.settled, false, 'still waiting just before the last doubled bound runs out')
  t.mock.timers.tick(1)
  await flush()
  assert.ok(request.error instanceof NetError)
  assert.equal(request.error.failure, 'no-response')
  assert.equal(request.error.message, 'silent.example: no response')
  assert.deepEqual(
    rankUrls(['https://silent.example', 'https://other.example']),
    ['https://other.example', 'https://silent.example'],
    'the silent host ranks behind the rest afterwards',
  )
})

test('a transfer that keeps moving is never cut off, however slow', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
  const fetchLike = createAdaptiveFetch(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => feed.error(init.signal!.reason), { once: true })
    return new Response(body)
  })
  const response = await fetchLike('https://slow.example/file')
  const reading = readBody(response)
  for (let piece = 0; piece < 6; piece += 1) {
    await advance(t, 20_000)
    feed.enqueue(new Uint8Array([piece]))
    await flush()
  }
  feed.close()
  assert.deepEqual([...await reading], [0, 1, 2, 3, 4, 5], 'two minutes of slow progress still completes')
})

test('a body that stops moving is dropped as stalled', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
  const fetchLike = createAdaptiveFetch(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => feed.error(init.signal!.reason), { once: true })
    return new Response(body)
  })
  const response = await fetchLike('https://stall.example/file')
  const reading = track(readBody(response))
  feed.enqueue(new Uint8Array([1]))
  await flush()
  await advance(t, 62_750)
  t.mock.timers.tick(249)
  await flush()
  assert.equal(reading.settled, false)
  t.mock.timers.tick(1)
  await flush()
  assert.ok(reading.error instanceof NetError)
  assert.equal(reading.error.failure, 'stalled')
  assert.equal(reading.error.message, 'stall.example: stopped sending data')
})

test('an upload is watched piece by piece, so a slow link is not mistaken for a dead one', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
  let received = 0
  const fetchLike = createAdaptiveFetch((_input, init) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    void (async () => {
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader()
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        received += next.value.byteLength
      }
      resolve(new Response('stored'))
    })()
  }))
  const upload = fetchLike('https://upload.example/files', { method: 'POST', body, duplex: 'half' } as RequestInit)
  for (let piece = 0; piece < 6; piece += 1) {
    await advance(t, 20_000)
    feed.enqueue(new Uint8Array(10))
    await flush()
  }
  feed.close()
  const response = await upload
  assert.equal(await response.text(), 'stored')
  assert.equal(received, 60)
})

test('an upload that stops moving is dropped instead of waiting forever', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let feed!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { feed = controller } })
  const upload = track(createAdaptiveFetch(hangUntilAborted)(
    'https://upload.example/files',
    { method: 'POST', body, duplex: 'half' } as RequestInit,
  ))
  feed.enqueue(new Uint8Array(10))
  await flush()
  await advance(t, 62_750)
  t.mock.timers.tick(249)
  await flush()
  assert.equal(upload.settled, false)
  t.mock.timers.tick(1)
  await flush()
  assert.ok(upload.error instanceof NetError)
  assert.equal(upload.error.failure, 'no-response')
})

test('cancelling stops the request and blames no host', async () => {
  resetHostStatsForTest()
  const controller = new AbortController()
  const pending = createAdaptiveFetch(hangUntilAborted)('https://cancelled.example/x', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (err: unknown) => isAbortError(err))
  assert.deepEqual(
    rankUrls(['https://cancelled.example', 'https://unseen.example']),
    ['https://cancelled.example', 'https://unseen.example'],
    'a cancelled host keeps its place',
  )
})

test('network failures are named in plain words and keep their cause', async () => {
  resetHostStatsForTest()
  const cases: Array<[string | undefined, NetError['failure'], string]> = [
    ['ECONNRESET', 'reset', 'connection reset'],
    ['UND_ERR_SOCKET', 'reset', 'connection reset'],
    ['ENOTFOUND', 'dns', 'DNS lookup failed'],
    ['ECONNREFUSED', 'refused', 'connection refused'],
    ['UND_ERR_CONNECT_TIMEOUT', 'connect-timeout', 'connection timed out'],
    ['CERT_HAS_EXPIRED', 'tls', 'TLS error'],
    [undefined, 'unreachable', 'unreachable'],
  ]
  for (const [code, failure, words] of cases) {
    const cause = networkError(code)
    const err = await createAdaptiveFetch(async () => { throw cause })('https://broken.example/x').then(() => null, (reason: unknown) => reason)
    assert.ok(err instanceof NetError, `${code ?? 'no code'} becomes a NetError`)
    assert.equal(err.failure, failure)
    assert.equal(err.message, `broken.example: ${words}`)
    assert.equal(err.cause, cause)
  }
})

test('a connection that dies mid-body surfaces as a named failure, not a raw socket error', async () => {
  resetHostStatsForTest()
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1]))
      controller.error(networkError('ECONNRESET'))
    },
  })
  const response = await createAdaptiveFetch(async () => new Response(body))('https://cutoff.example/file')
  await assert.rejects(readBody(response), (err: unknown) => err instanceof NetError && err.failure === 'reset')
})

test('failures are sorted into busy, broken, or final', () => {
  assert.equal(temporaryFailure(new NetError('h', 'reset')), 'broken')
  assert.equal(temporaryFailure(new NetError('h', 'dns')), 'broken')
  assert.equal(temporaryFailure(new NetError('h', 'no-response')), null, 'a host that used its whole backoff is not asked again')
  assert.equal(temporaryFailure(new NetError('h', 'stalled')), null)
  assert.equal(temporaryFailure(Object.assign(new Error('rate limited'), { busy: true })), 'busy')
  assert.equal(temporaryFailure(new Error('not found')), null)
})

type Flight = { signal: AbortSignal; resolve: (value: string) => void; reject: (err: unknown) => void }

function source(host: string): { calls: Flight[]; attempt: RaceAttempt<string> } {
  const calls: Flight[] = []
  return {
    calls,
    attempt: {
      host,
      run: signal => new Promise<string>((resolve, reject) => {
        calls.push({ signal, resolve, reject })
      }),
    },
  }
}

const busy = (): Error => Object.assign(new Error('rate limited'), { busy: true })

test('race: a failure hands over to the next source at once', async () => {
  resetHostStatsForTest()
  const a = source('a.example')
  const b = source('b.example')
  const race = createRace<string>()
  race.add(a.attempt)
  race.add(b.attempt)
  race.close()
  assert.equal(a.calls.length, 1)
  assert.equal(b.calls.length, 0, 'the second source waits while the first is on time')
  a.calls[0]!.reject(new Error('not found'))
  await flush()
  assert.equal(b.calls.length, 1)
  b.calls[0]!.resolve('from b')
  assert.equal(await race.result, 'from b')
})

test('race: a source that outlives its bound gets a competitor, and the first answer aborts the rest', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = source('a.example')
  const b = source('b.example')
  const race = createRace<string>()
  race.add(a.attempt)
  race.add(b.attempt)
  race.close()
  t.mock.timers.tick(999)
  assert.equal(b.calls.length, 0)
  t.mock.timers.tick(1)
  assert.equal(b.calls.length, 1, 'the competitor starts when the bound is reached')
  assert.equal(a.calls[0]!.signal.aborted, false, 'the slow source keeps running')
  b.calls[0]!.resolve('from b')
  assert.equal(await race.result, 'from b')
  assert.equal(a.calls[0]!.signal.aborted, true)
})

test('race: a source found late starts at once when every flight is overdue', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = source('a.example')
  const late = source('late.example')
  const race = createRace<string>()
  race.add(a.attempt)
  t.mock.timers.tick(1_000)
  race.add(late.attempt)
  assert.equal(late.calls.length, 1)
  late.calls[0]!.resolve('from late')
  assert.equal(await race.result, 'from late')

  const c = source('c.example')
  const d = source('d.example')
  const onTime = createRace<string>()
  onTime.add(c.attempt)
  onTime.add(d.attempt)
  assert.equal(d.calls.length, 0, 'no competitor while the first source is still on time')
  c.calls[0]!.resolve('from c')
  assert.equal(await onTime.result, 'from c')
})

test('race: when every source fails, each host keeps its own outcome', async () => {
  resetHostStatsForTest()
  const a = source('a.example')
  const b = source('b.example')
  const race = createRace<string>()
  const outcome = race.result.then(() => null, (err: unknown) => err)
  race.add(a.attempt)
  race.add(b.attempt)
  race.close()
  a.calls[0]!.reject(new Error('not found'))
  await flush()
  b.calls[0]!.reject(new Error('refused the request'))
  const err = await outcome
  assert.ok(err instanceof RaceError)
  assert.deepEqual(err.failures.map(failure => [failure.host, (failure.error as Error).message]), [
    ['a.example', 'not found'],
    ['b.example', 'refused the request'],
  ])
  assert.equal(err.message, 'a.example: not found; b.example: refused the request')
})

test('race: a broken connection is tried once more after the bound, and only once', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = source('a.example')
  const race = createRace<string>()
  race.add(a.attempt)
  race.close()
  a.calls[0]!.reject(new NetError('a.example', 'reset'))
  await flush()
  t.mock.timers.tick(999)
  assert.equal(a.calls.length, 1)
  t.mock.timers.tick(1)
  assert.equal(a.calls.length, 2)
  a.calls[1]!.resolve('second time')
  assert.equal(await race.result, 'second time')

  const b = source('b.example')
  const twice = createRace<string>()
  const outcome = twice.result.then(() => null, (err: unknown) => err)
  twice.add(b.attempt)
  twice.close()
  b.calls[0]!.reject(new NetError('b.example', 'reset'))
  await flush()
  t.mock.timers.tick(1_000)
  b.calls[1]!.reject(new NetError('b.example', 'reset'))
  const err = await outcome
  assert.ok(err instanceof RaceError)
  assert.equal(b.calls.length, 2, 'a connection that broke twice is reported, not retried again')
  assert.equal(err.message, 'b.example: connection reset')
})

test('race: a busy host is asked again with doubling waits until the backoff ceiling', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = source('a.example')
  const race = createRace<string>()
  const outcome = race.result.then(() => null, (err: unknown) => err)
  race.add(a.attempt)
  race.close()
  for (const wait of [1_000, 2_000, 4_000, 8_000, 16_000]) {
    a.calls.at(-1)!.reject(busy())
    await flush()
    const before = a.calls.length
    t.mock.timers.tick(wait - 1)
    assert.equal(a.calls.length, before, `still waiting just under ${wait}ms`)
    t.mock.timers.tick(1)
    assert.equal(a.calls.length, before + 1, `asked again after ${wait}ms`)
  }
  a.calls.at(-1)!.reject(busy())
  const err = await outcome
  assert.ok(err instanceof RaceError, 'the next doubling would pass the ceiling, so the race ends')
  assert.equal(a.calls.length, 6)
})

test('race: a busy host that recovers answers on a later ask', async t => {
  resetHostStatsForTest()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = source('a.example')
  const race = createRace<string>()
  race.add(a.attempt)
  race.close()
  a.calls[0]!.reject(busy())
  await flush()
  t.mock.timers.tick(1_000)
  a.calls[1]!.resolve('recovered')
  assert.equal(await race.result, 'recovered')
})

test('race: a host that stayed silent through its backoff is not asked again', async () => {
  resetHostStatsForTest()
  const a = source('a.example')
  const race = createRace<string>()
  const outcome = race.result.then(() => null, (err: unknown) => err)
  race.add(a.attempt)
  race.close()
  a.calls[0]!.reject(new NetError('a.example', 'no-response'))
  const err = await outcome
  assert.ok(err instanceof RaceError)
  assert.equal(a.calls.length, 1)
})

test('race: a definitive answer ends the race at once', async () => {
  resetHostStatsForTest()
  const a = source('a.example')
  const b = source('b.example')
  const verdict = new Error('execution reverted')
  const race = createRace<string>()
  const outcome = race.result.then(() => null, (err: unknown) => err)
  race.add(a.attempt)
  race.add(b.attempt)
  race.close()
  a.calls[0]!.reject(new DefinitiveError(verdict))
  assert.equal(await outcome, verdict)
  assert.equal(b.calls.length, 0)
})

test('race: cancelling aborts every flight and rejects as cancelled', async () => {
  resetHostStatsForTest()
  const controller = new AbortController()
  const a = source('a.example')
  const race = createRace<string>(controller.signal)
  const outcome = race.result.then(() => null, (err: unknown) => err)
  race.add(a.attempt)
  controller.abort()
  assert.ok(isAbortError(await outcome))
  assert.equal(a.calls[0]!.signal.aborted, true)
})
