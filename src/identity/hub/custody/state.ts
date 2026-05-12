import type { EthagentIdentity } from '../../../storage/config.js'
import { readOwnerAddressField } from '../../identityCompat.js'

export type CustodyMode = 'simple' | 'advanced'

export function readCustodyMode(state: Record<string, unknown> | undefined): CustodyMode | undefined {
  const s = (state ?? {}) as Record<string, unknown>
  const current = s.custodyMode
  if (current === 'simple' || current === 'advanced') return current
  if (current === 'single') return 'simple'
  if (current === 'multi') return 'advanced'
  const legacy = s.ensMode
  if (legacy === 'advanced') return 'advanced'
  if (legacy === 'simple') return 'simple'
  return undefined
}

export function displayCustodyMode(mode: CustodyMode | undefined): string {
  if (mode === 'advanced') return 'Advanced'
  if (mode === 'simple') return 'Simple'
  return 'Not set'
}

export function identityOwnerAddress(identity?: EthagentIdentity, verifiedOnchainOwner?: string): string {
  const onchainOwner = typeof verifiedOnchainOwner === 'string' ? verifiedOnchainOwner.trim() : ''
  if (onchainOwner) return onchainOwner
  if (!identity) return ''
  return readOwnerAddressField(identity.state as Record<string, unknown> | undefined)
    ?? identity.ownerAddress
    ?? identity.address
    ?? ''
}

export type IdentityPerspective = 'owner' | 'operator' | 'unknown'

export function identityPerspective(identity?: EthagentIdentity): IdentityPerspective {
  if (!identity) return 'unknown'
  const connected = identity.connectedWallet?.toLowerCase()
  if (!connected) return 'unknown'
  const ownerAddress = (readOwnerAddressField(identity.state as Record<string, unknown> | undefined) ?? identity.ownerAddress ?? identity.address)?.toLowerCase()
  if (ownerAddress && connected === ownerAddress) return 'owner'
  const activeOp = readIdentityStateString(identity.state as Record<string, unknown> | undefined, 'activeOperatorAddress')?.toLowerCase()
  if (activeOp && connected === activeOp) return 'operator'
  const approvedRaw = (identity.state as Record<string, unknown> | undefined)?.approvedOperatorWallets
  const approved = Array.isArray(approvedRaw) ? approvedRaw as Array<{ address?: unknown }> : []
  if (approved.some(r => typeof r?.address === 'string' && r.address.toLowerCase() === connected)) return 'operator'
  return 'unknown'
}

export function readIdentityStateString(state: Record<string, unknown> | undefined, key: string): string {
  if (key === 'ownerAddress') return readOwnerAddressField(state) ?? ''
  const value = state?.[key]
  return typeof value === 'string' ? value.trim() : ''
}
