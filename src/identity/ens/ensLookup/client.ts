import { createPublicClient, fallback, http, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { ENS_RPC_URLS, RPC_TIMEOUT_MS } from './constants.js'

export function createMainnetClient(): PublicClient {
  const transports = ENS_RPC_URLS.map(url => http(url, { retryCount: 0, timeout: RPC_TIMEOUT_MS }))
  return createPublicClient({
    chain: mainnet,
    transport: transports.length === 1 ? transports[0]! : fallback(transports, { retryCount: 0 }),
  })
}

class AbortedError extends Error {
  constructor() { super('Aborted') }
}

class TimedOutError extends Error {
  constructor(label: string) { super(`${label} timed out`) }
}

export function withDeadline<T>(promise: Promise<T>, ms: number, label: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new AbortedError())
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimedOutError(label)), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
