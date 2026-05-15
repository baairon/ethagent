import { toChecksumAddress } from '../crypto/eth.js'

export type ContinuitySnapshotToken = {
  chainId: number
  identityRegistryAddress: string
  agentId: string
}

export function normalizeContinuitySnapshotToken(input: unknown): ContinuitySnapshotToken {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Continuity snapshot token is invalid')
  }
  const obj = input as Partial<ContinuitySnapshotToken>
  if (typeof obj.chainId !== 'number' || !Number.isSafeInteger(obj.chainId) || obj.chainId <= 0) {
    throw new Error('Continuity snapshot token chain is invalid')
  }
  if (typeof obj.identityRegistryAddress !== 'string') {
    throw new Error('Continuity snapshot token registry is invalid')
  }
  if (typeof obj.agentId !== 'string' || !/^\d+$/.test(obj.agentId)) {
    throw new Error('Continuity snapshot token id is invalid')
  }
  return {
    chainId: obj.chainId,
    identityRegistryAddress: toChecksumAddress(obj.identityRegistryAddress),
    agentId: obj.agentId,
  }
}
