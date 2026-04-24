import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRetryableFetchError,
  classifyRetryableResponse,
  computeBackoffMs,
  fetchWithRetry,
} from '../src/utils/withRetry.js'

test('classifyRetryableFetchError flags known network codes as retryable', () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED']) {
    const result = classifyRetryableFetchError({ code })
    assert.equal(result.retryable, true, code)
    assert.equal(result.reason, code)
  }
})

test('classifyRetryableFetchError flags wrapped causes from undici', () => {
  const err = new TypeError('fetch failed')
  ;(err as any).cause = { code: 'ECONNRESET' }
  const result = classifyRetryableFetchError(err)
  assert.equal(result.retryable, true)
  assert.equal(result.reason, 'ECONNRESET')
})

test('classifyRetryableFetchError does not retry on TypeErrors from bad input', () => {
  const result = classifyRetryableFetchError(new Error('invalid URL'))
  assert.equal(result.retryable, false)
})

test('classifyRetryableResponse treats 429/503/529 as retryable with retry-after', () => {
  for (const status of [408, 429, 500, 502, 503, 504, 529]) {
    const response = new Response('upstream busy', {
      status,
      headers: { 'retry-after': '2' },
    })
    const classification = classifyRetryableResponse(response)
    assert.equal(classification.retryable, true, `status ${status}`)
    assert.equal(classification.retryAfterMs, 2000, `status ${status}`)
  }
})

test('classifyRetryableResponse treats 400/401/404 as non-retryable', () => {
  for (const status of [400, 401, 403, 404]) {
    const response = new Response('nope', { status })
    const classification = classifyRetryableResponse(response)
    assert.equal(classification.retryable, false, `status ${status}`)
  }
})

test('computeBackoffMs respects retry-after and caps exponential backoff', () => {
  const withHeader = computeBackoffMs(1, 1500)
  assert.equal(withHeader, 1500)

  const fifthAttempt = computeBackoffMs(5, undefined)
  assert.ok(fifthAttempt >= 500 * Math.pow(2, 4), 'should be at least the base exponential')
  assert.ok(fifthAttempt <= 32_000 * 1.25 + 1, 'should not exceed max delay plus 25% jitter')
})

test('fetchWithRetry retries a 503 then returns a successful response', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      return new Response('ok', { status: 200 })
    }) as typeof fetch

    const attempts: Array<{ attempt: number; delayMs: number; reason: string }> = []
    const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
      maxRetries: 3,
      onRetry: (event) => attempts.push(event),
    })

    assert.equal(response.status, 200)
    assert.equal(calls, 2)
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0]!.reason, 'HTTP 503')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchWithRetry surfaces non-retryable status codes without retrying', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('unauthorized', { status: 401 })
    }) as typeof fetch

    const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
      maxRetries: 3,
    })

    assert.equal(response.status, 401)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchWithRetry aborts immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, { signal: controller.signal }),
    (err: unknown) => err instanceof Error,
  )
})
