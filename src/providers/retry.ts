import type { ProviderRetryStreamEvent } from './contracts.js'
import { fetchWithRetry, type FetchWithRetryOptions, type RetryEvent } from '../utils/withRetry.js'

type FetchSettled =
  | { state: 'resolved'; response: Response }
  | { state: 'rejected'; error: unknown }

export async function* fetchWithRetryStreamEvents(
  input: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): AsyncGenerator<ProviderRetryStreamEvent, Response, void> {
  const retryEvents: ProviderRetryStreamEvent[] = []
  let settled: FetchSettled | undefined
  let wake: (() => void) | undefined

  const wakeWaiter = () => {
    const current = wake
    wake = undefined
    current?.()
  }

  const waitForChange = (): Promise<void> => new Promise(resolve => {
    wake = resolve
    if (settled || retryEvents.length > 0) wakeWaiter()
  })

  const fetchPromise = fetchWithRetry(input, init, {
    ...options,
    onRetry: (event: RetryEvent) => {
      options.onRetry?.(event)
      retryEvents.push({ type: 'retry', ...event })
      wakeWaiter()
    },
  }).then(
    response => {
      settled = { state: 'resolved', response }
      wakeWaiter()
    },
    error => {
      settled = { state: 'rejected', error }
      wakeWaiter()
    },
  )

  while (!settled || retryEvents.length > 0) {
    while (retryEvents.length > 0) {
      yield retryEvents.shift()!
    }
    if (settled) break
    await waitForChange()
  }

  await fetchPromise
  if (settled?.state === 'resolved') return settled.response
  if (settled?.state === 'rejected') throw settled.error
  throw new Error('fetch retry completed without a response')
}
