import { createPublicClient, fallback, http, type PublicClient } from 'viem'
import type { Erc8004RegistryConfig } from './types.js'
import { chainForId, rpcUrlsForClient } from './chains.js'

export function createErc8004PublicClient(args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'>): PublicClient {
  const transports = rpcUrlsForClient(args).map(url => http(url, { retryCount: 0, timeout: 8_000 }))
  return createPublicClient({
    chain: chainForId(args.chainId),
    transport: transports.length === 1 ? transports[0]! : fallback(transports, { retryCount: 0 }),
  })
}
