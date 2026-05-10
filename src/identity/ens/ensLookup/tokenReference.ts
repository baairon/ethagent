import { getAddress, isAddress } from 'viem'
import type { EnsAgentTokenReference } from './types.js'

export function parseAgentTokenReference(value: string): Omit<EnsAgentTokenReference, 'node' | 'resolverAddress'> | null {
  const match = value.trim().match(/^eip155:(\d+):(0x[0-9a-fA-F]{40}):(\d+)$/)
  if (!match) return null
  const chainId = Number(match[1])
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return null
  const registry = match[2]
  const tokenId = match[3]
  if (!registry || !isAddress(registry, { strict: false }) || !tokenId) return null
  return {
    chainId,
    identityRegistryAddress: getAddress(registry),
    agentId: BigInt(tokenId),
  }
}
