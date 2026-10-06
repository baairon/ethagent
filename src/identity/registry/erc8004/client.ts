import { createPublicClient, type PublicClient } from 'viem'
import type { Erc8004RegistryConfig } from './types.js'
import { chainForId, rpcUrlsForClient } from './chains.js'
import { adaptiveRpcTransport } from '../../../net/rpc.js'

export function createErc8004PublicClient(args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'>): PublicClient {
  return createPublicClient({
    chain: chainForId(args.chainId),
    transport: adaptiveRpcTransport(rpcUrlsForClient(args)),
  })
}
