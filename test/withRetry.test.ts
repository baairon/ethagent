import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRetryableFetchError,
  classifyRetryableResponse,
  computeBackoffMs,
  DEFAULT_RETRY_POLICY,
  fetchWithRetry,
  parseOpenAIRateLimitResetMs,
  parseRetryAfter,
  rateLimitResetDelayMs,
  retryPolicyFromOptions,
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

test('classifyRetryableResponse treats transient status codes as retryable with retry-after', () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503, 504, 529]) {
    const response = new Response('upstream busy', {
      status,
      headers: { 'retry-after': '2' },
    })
    const classification = classifyRetryableResponse(response)
    assert.equal(classification.retryable, true, `status ${status}`)
    assert.equal(classification.retryAfterMs, 2000, `status ${status}`)
    assert.equal(classification.status, status)
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

  const fifthAttempt = computeBackoffMs(5, undefined, 32_000, 500, () => 0)
  assert.ok(fifthAttempt >= 500 * Math.pow(2, 4), 'should be at least the base exponential')
  assert.ok(fifthAttempt <= 32_000 * 1.25 + 1, 'should not exceed max delay plus 25% jitter')
})

test('computeBackoffMs uses injected jitter deterministically', () => {
  assert.equal(computeBackoffMs(2, undefined, 32_000, 500, () => 0, 0.25), 1000)
  assert.equal(computeBackoffMs(2, undefined, 32_000, 500, () => 1, 0.25), 1250)
})

test('parseRetryAfter parses numeric seconds and HTTP dates', () => {
  const now = Date.parse('2026-04-30T00:00:00.000Z')
  assert.equal(parseRetryAfter('2', now), 2000)
  assert.equal(parseRetryAfter('Thu, 30 Apr 2026 00:01:00 GMT', now), 60_000)
  assert.equal(parseRetryAfter('Thu, 30 Apr 2026 00:00:00 GMT', now), 0)
  assert.equal(parseRetryAfter('not-a-date', now), undefined)
})

test('parseOpenAIRateLimitResetMs parses OpenAI-style duration strings', () => {
  assert.equal(parseOpenAIRateLimitResetMs('1s'), 1000)
  assert.equal(parseOpenAIRateLimitResetMs('6m0s'), 360_000)
  assert.equal(parseOpenAIRateLimitResetMs('1h30m0s'), 5_400_000)
  assert.equal(parseOpenAIRateLimitResetMs('500ms'), 500)
  assert.equal(parseOpenAIRateLimitResetMs('2m'), 120_000)
  assert.equal(parseOpenAIRateLimitResetMs('invalid'), undefined)
  assert.equal(parseOpenAIRateLimitResetMs(''), undefined)
})

test('rateLimitResetDelayMs reads Anthropic and OpenAI-compatible reset headers', () => {
  const now = Date.parse('2026-04-30T00:00:00.000Z')
  assert.equal(
    rateLimitResetDelayMs(new Headers({
      'anthropic-ratelimit-unified-reset': String(Math.floor(now / 1000) + 30),
    }), 'anthropic', now),
    30_000,
  )
  assert.equal(
    rateLimitResetDelayMs(new Headers({
      'x-ratelimit-reset-requests': '10s',
      'x-ratelimit-reset-tokens': '1m0s',
    }), 'openai-compatible', now),
    60_000,
  )
  assert.equal(rateLimitResetDelayMs(new Headers(), 'openai-compatible', now), undefined)
})

test('retryPolicyFromOptions preserves defaults and derives retry-after cap', () => {
  assert.deepEqual(retryPolicyFromOptions(), DEFAULT_RETRY_POLICY)
  assert.deepEqual(retryPolicyFromOptions({ maxRetries: 2, maxDelayMs: 1000 }), {
    ...DEFAULT_RETRY_POLICY,
    maxRetries: 2,
    maxDelayMs: 1000,
    retryAfterCapMs: 4000,
  })
})

test('fetchWithRetry retries a 503 then returns a successful response', async () => {
  let calls = 0
  const sleeps: number[] = []
  const attempts: Array<{ attempt: number; nextAttempt: number; maxRetries: number; delayMs: number; reason: string; status?: number }> = []
  const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
    maxRetries: 3,
    rng: () => 0,
    sleep: async ms => { sleeps.push(ms) },
    fetchImpl: (async () => {
      calls += 1
      if (calls === 1) return new Response('busy', { status: 503 })
      return new Response('ok', { status: 200 })
    }) as typeof fetch,
    onRetry: (event) => attempts.push(event),
  })

  assert.equal(response.status, 200)
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [500])
  assert.equal(attempts.length, 1)
  assert.deepEqual(attempts[0], {
    attempt: 1,
    nextAttempt: 2,
    maxRetries: 3,
    delayMs: 500,
    reason: 'HTTP 503',
    status: 503,
  })
})

test('fetchWithRetry uses injected now for HTTP-date retry-after headers', async () => {
  let calls = 0
  const sleeps: number[] = []
  const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
    maxRetries: 1,
    now: () => Date.parse('2026-04-30T00:00:00.000Z'),
    sleep: async ms => { sleeps.push(ms) },
    fetchImpl: (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('busy', {
          status: 503,
          headers: { 'retry-after': 'Thu, 30 Apr 2026 00:01:00 GMT' },
        })
      }
      return new Response('ok', { status: 200 })
    }) as typeof fetch,
  })

  assert.equal(response.status, 200)
  assert.deepEqual(sleeps, [60_000])
})

test('fetchWithRetry surfaces non-retryable status codes without retrying', async () => {
  let calls = 0
  const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
    maxRetries: 3,
    fetchImpl: (async () => {
      calls += 1
      return new Response('unauthorized', { status: 401 })
    }) as typeof fetch
  })

  assert.equal(response.status, 401)
  assert.equal(calls, 1)
})

test('fetchWithRetry cancels retryable response bodies before sleeping', async () => {
  let calls = 0
  let cancelled = false
  await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
    maxRetries: 1,
    sleep: async () => {},
    fetchImpl: (async () => {
      calls += 1
      if (calls === 1) {
        const body = new ReadableStream({
          cancel: () => { cancelled = true },
        })
        return new Response(body, { status: 503 })
      }
      return new Response('ok', { status: 200 })
    }) as typeof fetch,
  })

  assert.equal(cancelled, true)
})

test('fetchWithRetry returns the final retryable response when response retries are exhausted', async () => {
  let calls = 0
  const response = await fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
    maxRetries: 2,
    sleep: async () => {},
    fetchImpl: (async () => {
      calls += 1
      return new Response('busy', { status: 503 })
    }) as typeof fetch,
  })

  assert.equal(response.status, 503)
  assert.equal(calls, 3)
})

test('fetchWithRetry throws the final retryable fetch error when retries are exhausted', async () => {
  let calls = 0
  await assert.rejects(
    fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
      maxRetries: 2,
      sleep: async () => {},
      fetchImpl: (async () => {
        calls += 1
        const err = new Error('socket reset') as Error & { code?: string }
        err.code = 'ECONNRESET'
        throw err
      }) as typeof fetch,
    }),
    /socket reset/,
  )

  assert.equal(calls, 3)
})

test('fetchWithRetry aborts immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(
    fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
      signal: controller.signal,
      fetchImpl: (async () => {
        calls += 1
        return new Response('unused')
      }) as typeof fetch,
    }),
    (err: unknown) => err instanceof Error,
  )
  assert.equal(calls, 0)
})

test('fetchWithRetry aborts during retry backoff', async () => {
  const controller = new AbortController()
  await assert.rejects(
    fetchWithRetry('https://example.invalid/endpoint', { method: 'POST' }, {
      signal: controller.signal,
      fetchImpl: (async () => new Response('busy', { status: 503 })) as typeof fetch,
      sleep: async (_ms, signal) => {
        controller.abort()
        throw new DOMException(signal?.aborted ? 'aborted' : 'not aborted', 'AbortError')
      },
    }),
    /aborted/,
  )
})
