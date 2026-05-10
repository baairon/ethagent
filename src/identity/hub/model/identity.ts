import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { supportedErc8004ChainForId, type Erc8004AgentCandidate } from '../../registry/erc8004.js'
import { readCustodyMode, type CustodyMode } from './custody.js'
import { formatDate, shortAddress, shortCid } from './format.js'
import { chainSummaryRow, networkLabel } from './network.js'

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
): string {
  return `${tokenCandidateLabel(candidate)}${current ? '  *' : ''}`
}

export function tokenCandidateHint(candidate: Erc8004AgentCandidate): string {
  const chain = supportedErc8004ChainForId(candidate.chainId)
  const network = chain?.network ? networkLabel(chain.network) : chain?.name ?? `chain ${candidate.chainId}`
  const parts = [
    candidate.name?.trim() ? `token #${candidate.agentId.toString()}` : null,
    network,
    candidate.backup?.createdAt ? `backup ${formatDate(candidate.backup.createdAt)}` : null,
  ].filter((part): part is string => Boolean(part))
  return parts.join(' · ')
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

export function identitySummaryRows(
  identity: EthagentIdentity | undefined,
  config?: EthagentConfig,
): Array<{
  label: string
  value: string
  tone: 'ok' | 'dim'
}> {
  const backup = identity?.backup
  const owner = identity?.ownerAddress ?? identity?.address
  const ownerValue = owner ? shortAddress(owner) : 'not connected'
  const tokenValue = identity?.agentId ? `#${identity.agentId}` : 'not created'
  const chain = chainSummaryRow(config, identity)
  const stateValue = backup?.cid ? shortCid(backup.cid) : 'not saved yet'
  const skillsValue = identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'not saved'
  const cardValue = identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'not saved'
  const iconValue = typeof identity?.state?.imageUrl === 'string' && identity.state.imageUrl.trim() ? 'attached' : 'not attached'
  return [
    { label: 'owner wallet', value: ownerValue, tone: identity ? 'ok' : 'dim' },
    { label: 'token', value: tokenValue, tone: identity?.agentId ? 'ok' : 'dim' },
    { label: 'network', value: chain.value, tone: chain.tone },
    { label: 'state', value: stateValue, tone: backup ? 'ok' : 'dim' },
    { label: 'skills', value: skillsValue, tone: identity?.publicSkills?.cid ? 'ok' : 'dim' },
    { label: 'card', value: cardValue, tone: identity?.publicSkills?.agentCardCid ? 'ok' : 'dim' },
    { label: 'icon', value: iconValue, tone: iconValue === 'attached' ? 'ok' : 'dim' },
  ]
}

export function lastBackupLabel(identity?: EthagentIdentity): string {
  const created = identity?.backup?.createdAt
  return created ? formatDate(created) : 'never'
}
