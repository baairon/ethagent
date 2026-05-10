import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import { validateAgentEnsLink, type EnsValidation } from '../../../ens/ensLookup.js'
import { clearOwnerAddressField, clearOperatorVaultAddressField, readOwnerAddressField, setOperatorVaultAddressField, setOwnerAddressField } from '../../../identityCompat.js'
import { validateAdvancedEnsRelationship } from '../../advancedEnsValidation.js'
import { readCustodyMode } from '../../model/custody.js'
import { ensValidationReasonText } from '../../model/ens.js'
import type { ProfileUpdates } from '../../identityHubReducer.js'
import {
  assertActiveOperatorIsApproved,
  mergeApprovedOperatorWallets,
  normalizeApprovedOperatorWallets,
  upsertApprovedOperatorWallet,
} from '../../operatorWallets.js'
function ensValidationToState(validation: EnsValidation): Record<string, unknown> {
  const checkedAt = new Date().toISOString()
  if (validation.ok) {
    return { ok: true, resolvedAddress: validation.resolvedAddress, checkedAt }
  }
  return {
    ok: false,
    reason: validation.reason,
    ...(validation.detail ? { detail: validation.detail } : {}),
    checkedAt,
  }
}

export async function validateEnsForProfileUpdate(
  fullName: string,
  walletAccount: Address,
  profile: ProfileUpdates,
  baseState: Record<string, unknown>,
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
): Promise<EnsValidation> {
  const mode = readCustodyModeForUpdate(profile, baseState)
  if (mode === 'advanced') {
    const ownerAddress = readOwnerAddressForUpdate(profile, baseState)
    if (!ownerAddress) {
      return { ok: false, reason: 'lookup-failed', detail: 'no owner address recorded for advanced custody' }
    }
    const validation = await validateAdvancedEnsRelationship({
      fullName,
      ownerAddress: getAddress(ownerAddress),
      registry,
      agentId: identity.agentId,
    })
    return validation
  }
  return validateAgentEnsLink(fullName, walletAccount)
}

export function applyEnsValidationState(
  state: Record<string, unknown>,
  validation: EnsValidation,
  profile: ProfileUpdates,
  baseState: Record<string, unknown>,
): void {
  state.ensValidation = ensValidationToState(validation)
  if (!validation.ok) {
    throw new Error(`${ensValidationReasonText(validation.reason)}${validation.detail ? `: ${validation.detail}` : ''}`)
  }
  const mode = readCustodyModeForUpdate(profile, baseState)
  state.custodyMode = mode
  delete state.ensMode
  if (mode === 'advanced') {
    const ownerAddressValue = readOwnerAddressForUpdate(profile, baseState)
    const operatorWallet = readActiveOperatorForUpdate(profile, baseState)
    if (!ownerAddressValue || !operatorWallet) {
      throw new Error('Advanced custody requires owner wallet and operator wallet addresses')
    }
    const ownerAddress = getAddress(ownerAddressValue)
    const existingOperators = mergeApprovedOperatorWallets(baseState.approvedOperatorWallets, profile.approvedOperatorWallets ?? [], { walletAddress: ownerAddress })
    const approvedOperatorWallets = upsertApprovedOperatorWallet(existingOperators, getAddress(operatorWallet), { walletAddress: ownerAddress })
    setOwnerAddressField(state, getAddress(ownerAddress))
    state.approvedOperatorWallets = approvedOperatorWallets
    state.activeOperatorAddress = getAddress(operatorWallet)
    return
  }
  clearOwnerAddressField(state)
  delete state.approvedOperatorWallets
  delete state.activeOperatorAddress
}

export function applyOperatorProfileState(
  state: Record<string, unknown>,
  profile: ProfileUpdates,
  baseState: Record<string, unknown>,
): void {
  const operatorFieldsTouched = profile.custodyMode !== undefined
    || profile.ownerAddress !== undefined
    || profile.approvedOperatorWallets !== undefined
    || profile.activeOperatorAddress !== undefined
    || profile.operatorVaultAddress !== undefined
    || profile.restoreAccessEpoch !== undefined
  if (!operatorFieldsTouched) return

  if (profile.custodyMode === 'simple') {
    state.custodyMode = 'simple'
    delete state.ensMode
    clearOwnerAddressField(state)
    delete state.approvedOperatorWallets
    delete state.activeOperatorAddress
    if (profile.restoreAccessEpoch !== undefined) {
      state.restoreAccessEpoch = profile.restoreAccessEpoch
    }
    return
  }
  if (profile.custodyMode === 'advanced') {
    state.custodyMode = 'advanced'
    delete state.ensMode
  }

  if (profile.operatorVaultAddress !== undefined) {
    if (typeof profile.operatorVaultAddress === 'string' && profile.operatorVaultAddress.trim()) {
      setOperatorVaultAddressField(state, getAddress(profile.operatorVaultAddress))
    } else {
      clearOperatorVaultAddressField(state)
    }
  }

  if (typeof profile.ownerAddress === 'string' && profile.ownerAddress.trim()) {
    setOwnerAddressField(state, getAddress(profile.ownerAddress))
  }

  const approvedOperatorWallets = profile.approvedOperatorWallets !== undefined
    ? normalizeApprovedOperatorWallets(profile.approvedOperatorWallets)
    : normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  if (profile.approvedOperatorWallets !== undefined) {
    const ownerForCheck = readOwnerAddressField(state) ?? readOwnerAddressField(baseState) ?? ''
    if (ownerForCheck && isAddress(ownerForCheck, { strict: false })) {
      const ownerLower = ownerForCheck.toLowerCase()
      if (approvedOperatorWallets.some(record => record.address.toLowerCase() === ownerLower)) {
        throw new Error('Operator wallet must be different from the owner wallet')
      }
    }
    state.approvedOperatorWallets = approvedOperatorWallets
  }

  const active = profile.activeOperatorAddress !== undefined
    ? assertActiveOperatorIsApproved(approvedOperatorWallets, profile.activeOperatorAddress)
    : assertActiveOperatorIsApproved(approvedOperatorWallets, readActiveOperatorForUpdate({}, baseState))
  if (active) {
    state.activeOperatorAddress = active
  } else if (profile.activeOperatorAddress !== undefined) {
    delete state.activeOperatorAddress
  }
  if (profile.restoreAccessEpoch !== undefined) {
    state.restoreAccessEpoch = profile.restoreAccessEpoch
  }
}

function readCustodyModeForUpdate(profile: ProfileUpdates, baseState: Record<string, unknown>): 'simple' | 'advanced' {
  if (profile.custodyMode === 'simple' || profile.custodyMode === 'advanced') return profile.custodyMode
  return readCustodyMode(baseState) ?? 'simple'
}

function readOwnerAddressForUpdate(profile: ProfileUpdates, baseState: Record<string, unknown>): string | undefined {
  if (typeof profile.ownerAddress === 'string' && profile.ownerAddress.trim()) return profile.ownerAddress.trim()
  return readOwnerAddressField(baseState)
}

function readActiveOperatorForUpdate(profile: ProfileUpdates, baseState: Record<string, unknown>): string | undefined {
  if (typeof profile.activeOperatorAddress === 'string' && profile.activeOperatorAddress.trim()) return profile.activeOperatorAddress.trim()
  const profileApproved = normalizeApprovedOperatorWallets(profile.approvedOperatorWallets)
  if (profileApproved[0]) return profileApproved[0].address
  const storedActive = baseState.activeOperatorAddress
  if (typeof storedActive === 'string' && storedActive.trim()) return storedActive.trim()
  const storedApproved = normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  if (storedApproved[0]) return storedApproved[0].address
  return undefined
}
