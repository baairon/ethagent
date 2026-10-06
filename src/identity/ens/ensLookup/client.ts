import { createPublicClient, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { adaptiveRpcTransport } from '../../../net/rpc.js'
import { ENS_RPC_URLS } from './constants.js'

// ENS lives on mainnet. Reads go through the adaptive transport: each endpoint gets the
// bound it has earned, a slow one gets a competitor, and nothing is cut off by a fixed
// limit.
export function createMainnetClient(): PublicClient {
  return createPublicClient({
    chain: mainnet,
    transport: adaptiveRpcTransport(ENS_RPC_URLS),
  })
}

class AbortedError extends Error {
  constructor() {
    super('The operation was cancelled.')
    this.name = 'AbortError'
  }
}

// Ends the wait when the caller cancels. There is no time limit: the transport decides
// when an endpoint has stopped answering.
export function cancellable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new AbortedError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
