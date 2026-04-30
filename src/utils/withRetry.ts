export type RetryClassification = {
  retryable: boolean
  retryAfterMs?: number
  reason: string
  status?: number
  code?: string
}

export type RetryPolicy = {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryAfterCapMs: number
  jitterRatio: number
}

export type RetryEvent = {
  attempt: number
  nextAttempt: number
  maxRetries: number
  delayMs: number
  reason: string
  retryAfterMs?: number
  status?: number
  code?: string
}

const RETRYABLE_NET_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
])

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
const DEFAULT_BASE_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 32_000
const DEFAULT_JITTER_RATIO = 0.25
const DEFAULT_MAX_RETRIES = 4

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: DEFAULT_MAX_RETRIES,
  baseDelayMs: DEFAULT_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  retryAfterCapMs: DEFAULT_MAX_DELAY_MS * 4,
  jitterRatio: DEFAULT_JITTER_RATIO,
}

export function classifyRetryableFetchError(err: unknown): RetryClassification {
  if (!err || typeof err !== 'object') return { retryable: false, reason: 'unknown error' }
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && RETRYABLE_NET_CODES.has(code)) {
    return { retryable: true, reason: code, code }
  }
  const cause = (err as { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code
    if (typeof causeCode === 'string' && RETRYABLE_NET_CODES.has(causeCode)) {
      return { retryable: true, reason: causeCode, code: causeCode }
    }
  }
  const message = (err as { message?: unknown }).message
  if (typeof message === 'string' && /fetch failed|network|socket hang up|ECONNRESET/i.test(message)) {
    return { retryable: true, reason: 'fetch failed' }
  }
  return { retryable: false, reason: 'non-retryable error' }
}

export function classifyRetryableResponse(response: Response, nowMs: number = Date.now()): RetryClassification {
  if (response.ok) return { retryable: false, reason: 'ok', status: response.status }
  if (!RETRYABLE_STATUS.has(response.status)) {
    return { retryable: false, reason: `HTTP ${response.status}`, status: response.status }
  }
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = retryAfter ? parseRetryAfter(retryAfter, nowMs) : undefined
  return { retryable: true, retryAfterMs, reason: `HTTP ${response.status}`, status: response.status }
}

export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  rng: () => number = Math.random,
  jitterRatio = DEFAULT_JITTER_RATIO,
  retryAfterCapMs = maxDelayMs * 4,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    return Math.min(Math.max(retryAfterMs, 0), retryAfterCapMs)
  }
  const expo = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = rng() * jitterRatio * expo
  return Math.floor(expo + jitter)
}

export function retryPolicyFromOptions(options: FetchWithRetryOptions = {}): RetryPolicy {
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs
  return {
    maxRetries: options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs,
    maxDelayMs,
    retryAfterCapMs: options.retryAfterCapMs ?? maxDelayMs * 4,
    jitterRatio: options.jitterRatio ?? DEFAULT_RETRY_POLICY.jitterRatio,
  }
}

export function parseRetryAfter(headerValue: string, nowMs: number = Date.now()): number | undefined {
  const trimmed = headerValue.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(trimmed)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs)
  return undefined
}

export function parseOpenAIRateLimitResetMs(value: string): number | undefined {
  if (!value) return undefined
  const match = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(value.trim())
  if (!match || match[0] === '') return undefined
  const hours = Number.parseInt(match[1] ?? '0', 10)
  const minutes = Number.parseInt(match[2] ?? '0', 10)
  const seconds = Number.parseInt(match[3] ?? '0', 10)
  const milliseconds = Number.parseInt(match[4] ?? '0', 10)
  const total = hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + milliseconds
  return total > 0 ? total : undefined
}

export type RateLimitResetProvider = 'anthropic' | 'openai-compatible'

export function rateLimitResetDelayMs(
  headers: Headers,
  provider: RateLimitResetProvider,
  nowMs: number = Date.now(),
  capMs = DEFAULT_RETRY_POLICY.retryAfterCapMs,
): number | undefined {
  if (provider === 'anthropic') {
    const reset = headers.get('anthropic-ratelimit-unified-reset')
    if (!reset) return undefined
    const unixSeconds = Number(reset)
    if (!Number.isFinite(unixSeconds)) return undefined
    const delay = unixSeconds * 1000 - nowMs
    return delay > 0 ? Math.min(delay, capMs) : undefined
  }

  const requestDelay = parseOpenAIRateLimitResetMs(headers.get('x-ratelimit-reset-requests') ?? '')
  const tokenDelay = parseOpenAIRateLimitResetMs(headers.get('x-ratelimit-reset-tokens') ?? '')
  const delay = Math.max(requestDelay ?? 0, tokenDelay ?? 0)
  return delay > 0 ? Math.min(delay, capMs) : undefined
}

export type FetchWithRetryOptions = {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryAfterCapMs?: number
  jitterRatio?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  rng?: () => number
  now?: () => number
  onRetry?: (event: RetryEvent) => void
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const policy = retryPolicyFromOptions(options)
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleep ?? sleep
  const rng = options.rng ?? Math.random
  const now = options.now ?? Date.now
  let lastError: unknown
  for (let attempt = 1; attempt <= policy.maxRetries + 1; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')

    try {
      const response = await fetchImpl(input, { ...init, signal: options.signal })
      if (response.ok) return response

      const classification = classifyRetryableResponse(response, now())
      if (!classification.retryable || attempt > policy.maxRetries) return response

      try { await response.body?.cancel() } catch { /* ignore */ }
      const delayMs = computeBackoffMs(
        attempt,
        classification.retryAfterMs,
        policy.maxDelayMs,
        policy.baseDelayMs,
        rng,
        policy.jitterRatio,
        policy.retryAfterCapMs,
      )
      options.onRetry?.(retryEvent(attempt, policy.maxRetries, delayMs, classification))
      await sleepImpl(delayMs, options.signal)
      continue
    } catch (err) {
      lastError = err
      if (options.signal?.aborted) throw err
      const classification = classifyRetryableFetchError(err)
      if (!classification.retryable || attempt > policy.maxRetries) throw err

      const delayMs = computeBackoffMs(
        attempt,
        classification.retryAfterMs,
        policy.maxDelayMs,
        policy.baseDelayMs,
        rng,
        policy.jitterRatio,
        policy.retryAfterCapMs,
      )
      options.onRetry?.(retryEvent(attempt, policy.maxRetries, delayMs, classification))
      await sleepImpl(delayMs, options.signal)
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted')
}

function retryEvent(
  attempt: number,
  maxRetries: number,
  delayMs: number,
  classification: RetryClassification,
): RetryEvent {
  return {
    attempt,
    nextAttempt: attempt + 1,
    maxRetries,
    delayMs,
    reason: classification.reason,
    ...(classification.retryAfterMs !== undefined ? { retryAfterMs: classification.retryAfterMs } : {}),
    ...(classification.status !== undefined ? { status: classification.status } : {}),
    ...(classification.code !== undefined ? { code: classification.code } : {}),
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
