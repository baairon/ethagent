import type { EthagentIdentity } from '../../../storage/config.js'
import type { Erc8004AgentCandidate } from '../../registry/erc8004.js'
import type { CustodyMode } from '../custody/state.js'
import { formatDate } from '../shared/model/format.js'
import { truncateEnd } from '../../../ui/text.js'

export const PREFLIGHT_AGENT_URI = 'ipfs://bafybeigdyrztma2dbfczw7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6y7q'

export function initialAgentState(name: string, description: string, ownerAddress: string): Record<string, unknown> {
  return {
    version: 1,
    name,
    description,
    ownerAddress,
    custodyMode: 'simple' as CustodyMode,
    createdAt: new Date().toISOString(),
    preferences: {},
    memory: {},
  }
}

export function tokenCandidateLabel(candidate: Erc8004AgentCandidate): string {
  return candidate.name?.trim() || `Agent Token #${candidate.agentId.toString()}`
}

export function tokenCandidateSelectLabel(
  candidate: Erc8004AgentCandidate,
  current = false,
  maxLength = Number.POSITIVE_INFINITY,
): string {
  const suffix = current ? ' (current)' : ''
  return `${truncateEnd(tokenCandidateLabel(candidate), maxLength - suffix.length)}${suffix}`
}

export function isCurrentAgentCandidate(
  identity: EthagentIdentity | undefined,
  candidate: Erc8004AgentCandidate,
): boolean {
  if (!identity?.agentId) return false
  if (identity.agentId !== candidate.agentId.toString()) return false

  const owner = identity.ownerAddress ?? identity.address
  if (owner && owner.toLowerCase() !== candidate.ownerAddress.toLowerCase()) return false
  if (identity.chainId !== undefined && identity.chainId !== candidate.chainId) return false
  if (
    identity.identityRegistryAddress
    && identity.identityRegistryAddress.toLowerCase() !== candidate.identityRegistryAddress.toLowerCase()
  ) {
    return false
  }
  return true
}

export function lastBackupLabel(identity?: EthagentIdentity): string {
  const created = identity?.backup?.createdAt
  return created ? formatDate(created) : 'never'
}
