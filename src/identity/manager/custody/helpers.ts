import type { EthagentIdentity } from '../../../storage/config.js'
import { getAddress } from 'viem'
import { readOwnerAddressField } from '../../identityCompat.js'
import { normalizeApprovedOperatorWallets } from '../shared/operatorWallets.js'
import { supportedErc8004ChainForId } from '../../registry/erc8004.js'

export function chainLabel(chainId: number): string {
  return supportedErc8004ChainForId(chainId)?.name ?? `chain ${chainId}`
}

export function humanOwnerAddress(identity: EthagentIdentity): `0x${string}` {
  const stateOwnerAddress = readOwnerAddressField(identity.state as Record<string, unknown> | undefined)
  if (stateOwnerAddress && /^0x[a-fA-F0-9]{40}$/.test(stateOwnerAddress)) {
    return stateOwnerAddress as `0x${string}`
  }
  return (identity.ownerAddress ?? identity.address) as `0x${string}`
}

// Every operator local state knows of for this identity: the approved list and the
// active one, checksummed and without repeats.
export function localOperatorAddresses(identity: EthagentIdentity): `0x${string}`[] {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const out = new Map<string, `0x${string}`>()
  for (const record of normalizeApprovedOperatorWallets(state.approvedOperatorWallets)) {
    out.set(record.address.toLowerCase(), getAddress(record.address))
  }
  const active = typeof state.activeOperatorAddress === 'string' ? state.activeOperatorAddress.trim() : ''
  if (/^0x[0-9a-fA-F]{40}$/.test(active)) out.set(active.toLowerCase(), getAddress(active))
  return [...out.values()]
}
