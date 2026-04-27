import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../storage/config.js'
import {
  RegisterAgentPreflightError,
  supportedErc8004ChainForId,
  type Erc8004AgentCandidate,
} from './erc8004.js'
import { AgentStateOwnerMismatchError } from './backupEnvelope.js'
import { resolveSelectedNetwork } from './registryConfig.js'

export const PREFLIGHT_AGENT_URI = 'ipfs://bafybeigdyrztma2dbfczw7q6ooozbxlqzyw5r7w4f3qw2axvvxqg3w6y7q'

export type IdentityHubErrorView = {
  title: string
  detail?: string
  hint?: string
}

export function initialAgentState(name: string, description: string, ownerAddress: string): Record<string, unknown> {
  return {
    version: 1,
    name,
    description,
    ownerAddress,
    createdAt: new Date().toISOString(),
    preferences: {},
    memory: {},
  }
}

export function identityHubErrorView(err: unknown): IdentityHubErrorView {
  if (err instanceof RegisterAgentPreflightError) {
    return {
      title: err.title,
      detail: err.detail,
      hint: err.hint,
    }
  }
  if (err instanceof AgentStateOwnerMismatchError) {
    return {
      title: 'snapshot locked to previous wallet',
      detail: `token owner ${shortAddress(err.currentOwner)} cannot read state encrypted for ${shortAddress(err.snapshotOwner)}.`,
      hint: 'Use the wallet that authorized this snapshot.',
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (message === 'fetch failed') {
    return {
      title: 'storage unavailable',
      detail: 'could not reach storage.',
      hint: 'check the connection, then try again.',
    }
  }
  return {
    title: 'identity error',
    detail: message,
  }
}

export function pinataErrorText(err: unknown): string {
  const view = identityHubErrorView(err)
  return view.detail ?? view.title
}

export function isRegistrationPreflightError(err: unknown): boolean {
  return err instanceof RegisterAgentPreflightError
}

export function shortCid(cid: string): string {
  if (cid.length <= 18) return cid
  return `${cid.slice(0, 10)}...${cid.slice(-6)}`
}

export function shortAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function shortHash(value: string): string {
  if (value.length <= 18) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

export function tokenLabel(candidate: Erc8004AgentCandidate): string {
  return tokenCandidateLabel(candidate)
}

export function tokenCandidateLabel(candidate: Erc8004AgentCandidate): string {
  return `#${candidate.agentId.toString()} · ${candidate.name?.trim() || 'unnamed agent'}`
}

export function tokenCandidateHint(candidate: Erc8004AgentCandidate): string {
  const chain = supportedErc8004ChainForId(candidate.chainId)
  const network = chain?.network ? networkLabel(chain.network) : chain?.name ?? `chain ${candidate.chainId}`
  if (candidate.backup?.createdAt) return `${network} · pinned ${formatDate(candidate.backup.createdAt)}`
  return network
}

export function storageLabel(apiUrl: string): string {
  return apiUrl.includes('pinata.cloud') ? 'Pinata' : 'custom storage'
}

const NETWORK_LABELS: Record<SelectableNetwork, string> = {
  mainnet:  'ethereum mainnet',
  arbitrum: 'arbitrum one',
  base:     'base',
  optimism: 'optimism',
  polygon:  'polygon',
}

export function networkLabel(network: SelectableNetwork): string {
  return NETWORK_LABELS[network]
}

const NETWORK_SUBTITLES: Record<SelectableNetwork, string> = {
  mainnet:  'agent tokens on ethereum mainnet.',
  arbitrum: 'agent tokens on arbitrum one.',
  base:     'agent tokens on base.',
  optimism: 'agent tokens on optimism.',
  polygon:  'agent tokens on polygon.',
}

export function networkSubtitle(network: SelectableNetwork): string {
  return NETWORK_SUBTITLES[network]
}

export function networkMenuTagline(): string {
  return 'choose where your agent token is created or found.'
}

export function currentNetworkLine(config?: EthagentConfig): string {
  return networkLabel(resolveSelectedNetwork(config))
}

export function selectedNetworkFooter(config?: EthagentConfig): string {
  return `network: ${networkLabel(resolveSelectedNetwork(config))}`
}

export function chainSummaryRow(config?: EthagentConfig, identity?: EthagentIdentity): {
  label: string
  value: string
  tone: 'ok' | 'dim'
} {
  const network = resolveSelectedNetwork(config)
  const fromIdentity = identity?.chainId ? supportedErc8004ChainForId(identity.chainId)?.name.toLowerCase() : undefined
  const value = fromIdentity ?? networkLabel(network)
  return { label: 'chain', value, tone: identity?.chainId ? 'ok' : 'dim' }
}

export function lastBackupLabel(identity?: EthagentIdentity): string {
  const created = identity?.backup?.createdAt
  return created ? formatDate(created) : 'never'
}

export function identitySummaryRows(
  identity: EthagentIdentity | undefined,
): Array<{
  label: string
  value: string
  tone: 'ok' | 'dim'
}> {
  const backup = identity?.backup
  const owner = identity?.ownerAddress ?? identity?.address
  const ownerValue = owner ? shortAddress(owner) : 'not connected'
  const tokenValue = identity?.agentId ? `#${identity.agentId}` : 'not created'
  const stateValue = backup?.cid ? shortCid(backup.cid) : 'not saved yet'
  return [
    { label: 'owner', value: ownerValue, tone: identity ? 'ok' : 'dim' },
    { label: 'token', value: tokenValue, tone: identity?.agentId ? 'ok' : 'dim' },
    { label: 'state', value: stateValue, tone: backup ? 'ok' : 'dim' },
  ]
}

export type IdentityDetailSection = {
  title: string
  rows: Array<{
    label: string
    value: string
    tone: 'ok' | 'dim'
  }>
}

export function identityDetailSections(
  identity: EthagentIdentity | undefined,
  config?: EthagentConfig,
): IdentityDetailSection[] {
  const backup = identity?.backup
  const owner = identity?.ownerAddress ?? identity?.address
  const chain = chainSummaryRow(config, identity)
  const stateCid = backup?.cid ?? 'not saved yet'
  const registrationCid = identity?.metadataCid ?? 'not saved yet'

  return [
    {
      title: 'Agent',
      rows: [
        { label: 'token', value: identity?.agentId ? `#${identity.agentId}` : 'not created', tone: identity?.agentId ? 'ok' : 'dim' },
        { label: 'network', value: chain.value, tone: chain.tone },
        { label: 'registration', value: registrationCid, tone: identity?.metadataCid ? 'ok' : 'dim' },
      ],
    },
    {
      title: 'Owner',
      rows: [
        { label: 'wallet', value: owner ?? 'not connected', tone: owner ? 'ok' : 'dim' },
      ],
    },
    {
      title: 'Recovery',
      rows: [
        { label: 'state CID', value: stateCid, tone: backup?.cid ? 'ok' : 'dim' },
        { label: 'storage', value: backup?.ipfsApiUrl ? storageLabel(backup.ipfsApiUrl) : 'not saved yet', tone: backup?.ipfsApiUrl ? 'ok' : 'dim' },
        { label: 'created', value: identity?.createdAt ? formatDate(identity.createdAt) : 'not created', tone: identity?.createdAt ? 'ok' : 'dim' },
        { label: 'last backup', value: backup?.createdAt ? formatDate(backup.createdAt) : 'never', tone: backup?.createdAt ? 'ok' : 'dim' },
        { label: 'status', value: backup?.status ?? 'unknown', tone: backup?.status ? 'ok' : 'dim' },
      ],
    },
  ]
}

export type CopyableField = {
  label: string
  value: string
}

export function copyableIdentityFields(identity?: EthagentIdentity): CopyableField[] {
  if (!identity) return []
  const fields: CopyableField[] = []
  if (identity.backup?.cid) fields.push({ label: 'state CID', value: identity.backup.cid })
  if (identity.metadataCid) fields.push({ label: 'registration CID', value: identity.metadataCid })
  if (identity.agentUri) fields.push({ label: 'agent URI', value: identity.agentUri })
  const owner = identity.ownerAddress ?? identity.address
  if (owner) fields.push({ label: 'owner address', value: owner })
  if (identity.agentId) fields.push({ label: 'token id', value: identity.agentId })
  return fields
}

function formatDate(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toISOString().slice(0, 10)
}
