export type RetryClassification = {
  retryable: boolean
  retryAfterMs?: number
  reason: string
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

export function classifyRetryableFetchError(err: unknown): RetryClassification {
  if (!err || typeof err !== 'object') return { retryable: false, reason: 'unknown error' }
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && RETRYABLE_NET_CODES.has(code)) {
    return { retryable: true, reason: code }
  }
  const cause = (err as { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code
    if (typeof causeCode === 'string' && RETRYABLE_NET_CODES.has(causeCode)) {
      return { retryable: true, reason: causeCode }
    }
  }
  const message = (err as { message?: unknown }).message
  if (typeof message === 'string' && /fetch failed|network|socket hang up|ECONNRESET/i.test(message)) {
    return { retryable: true, reason: 'fetch failed' }
  }
  return { retryable: false, reason: 'non-retryable error' }
}

export function classifyRetryableResponse(response: Response): RetryClassification {
  if (response.ok) return { retryable: false, reason: 'ok' }
  if (!RETRYABLE_STATUS.has(response.status)) {
    return { retryable: false, reason: `HTTP ${response.status}` }
  }
  const retryAfter = response.headers.get('retry-after')
  const retryAfterMs = retryAfter ? parseRetryAfter(retryAfter) : undefined
  return { retryable: true, retryAfterMs, reason: `HTTP ${response.status}` }
}

export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  maxDelayMs = 32_000,
  baseDelayMs = 500,
): number {
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    return Math.min(Math.max(retryAfterMs, 0), maxDelayMs * 4)
  }
  const expo = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * expo
  return Math.floor(expo + jitter)
}

export type FetchWithRetryOptions = {
  maxRetries?: number
  signal?: AbortSignal
  onRetry?: (event: { attempt: number; delayMs: number; reason: string }) => void
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 4
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')

    try {
      const response = await fetch(input, { ...init, signal: options.signal })
      if (response.ok) return response

      const classification = classifyRetryableResponse(response)
      if (!classification.retryable || attempt > maxRetries) return response

      try { await response.body?.cancel() } catch { /* ignore */ }
      const delayMs = computeBackoffMs(attempt, classification.retryAfterMs)
      options.onRetry?.({ attempt, delayMs, reason: classification.reason })
      await sleep(delayMs, options.signal)
      continue
    } catch (err) {
      lastError = err
      if (options.signal?.aborted) throw err
      const classification = classifyRetryableFetchError(err)
      if (!classification.retryable || attempt > maxRetries) throw err

      const delayMs = computeBackoffMs(attempt, classification.retryAfterMs)
      options.onRetry?.({ attempt, delayMs, reason: classification.reason })
      await sleep(delayMs, options.signal)
    }
  }
  throw lastError ?? new Error('fetchWithRetry exhausted')
}

function parseRetryAfter(headerValue: string): number | undefined {
  const trimmed = headerValue.trim()
  if (!trimmed) return undefined
  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(trimmed)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
