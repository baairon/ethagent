import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import { readCustodyMode, readIdentityStateString } from '../../custody/state.js'

type CopyableField = {
  label: string
  value: string
}

export function copyableIdentityFields(identity?: EthagentIdentity, config?: EthagentConfig): CopyableField[] {
  if (!identity) return []
  const fields: CopyableField[] = []
  if (identity.agentId) fields.push({ label: 'Token ID', value: identity.agentId })
  const ensName = readIdentityStateString(identity.state, 'ensName')
  if (ensName) fields.push({ label: 'ENS Name', value: ensName })
  const agentUri = identity.agentUri ?? (identity.metadataCid ? `ipfs://${identity.metadataCid}` : undefined)
  if (agentUri) fields.push({ label: 'Agent URI', value: agentUri })
  const ownerAddress = readIdentityStateString(identity.state, 'ownerAddress')
  const owner = identity.ownerAddress ?? identity.address
  const ownerWallet = ownerAddress || owner
  if (ownerWallet) fields.push({ label: 'Owner Wallet', value: ownerWallet })
  const custodyMode = readCustodyMode(identity.state)
  if (custodyMode === 'advanced') {
    const vaultAddress = readIdentityStateString(identity.state, 'operatorVaultAddress')
    if (vaultAddress) fields.push({ label: 'Vault', value: vaultAddress })
  }
  const activeOperator = readIdentityStateString(identity.state, 'activeOperatorAddress')
  if (activeOperator) fields.push({ label: 'Operator Wallet', value: activeOperator })
  return fields
}

export function identityValuesCopyHint(_identity?: EthagentIdentity): string {
  return 'Copy token and pointers'
}
