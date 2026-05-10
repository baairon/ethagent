import type { Address, Hex, PublicClient } from 'viem'

export type EnsValidation =
  | { ok: true; resolvedAddress: Address; resolverAddress: Address }
  | {
      ok: false
      reason:
        | 'no-owner'
        | 'no-resolver'
        | 'address-mismatch'
        | 'lookup-failed'
        | 'token-owner-mismatch'
        | 'token-owner-lookup-failed'
      detail?: string
    }

export type DiscoverOptions = {
  signal?: AbortSignal
  budgetMs?: number
  rpcTimeoutMs?: number
  scanWindowBlocks?: bigint
  publicClient?: PublicClient
}

export type EnsNameDiscoveryResult = {
  status: 'ok' | 'partial' | 'error'
  names: string[]
  sourcesChecked: string[]
  errors: string[]
}

export type EnsAgentTokenReference = {
  chainId: number
  identityRegistryAddress: Address
  agentId: bigint
  node: Hex
  resolverAddress: Address
}
