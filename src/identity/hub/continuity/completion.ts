import type { EthagentIdentity } from '../../../storage/config.js'
import type { WalletPurpose } from '../../wallet/browserWallet.js'
import type { ProfileUpdates } from '../identityHubReducer.js'
import { snapshotSaveWalletRole } from './snapshot.js'

export function rebackupWalletPurpose(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): WalletPurpose {
  const role = snapshotSaveWalletRole(identity, profileUpdates)
  const snapshotPurpose = role === 'operator'
    ? 'update-snapshot-operator' as const
    : role === 'owner'
      ? 'update-snapshot-owner' as const
      : 'update-snapshot-connected' as const
  const profilePurpose = role === 'operator'
    ? 'update-profile-operator' as const
    : role === 'owner'
      ? 'update-profile-owner' as const
      : 'update-profile-connected' as const
  if (!profileUpdates) return snapshotPurpose
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const currentEns = typeof baseState.ensName === 'string' ? baseState.ensName.trim() : ''
  const ensTouched = typeof profileUpdates.ensName === 'string'
  const profileFieldsTouched = profileUpdates.name !== undefined
    || profileUpdates.description !== undefined
    || profileUpdates.imagePath !== undefined
  const operatorFieldsTouched = profileUpdates.ownerAddress !== undefined
    || profileUpdates.approvedOperatorWallets !== undefined
    || profileUpdates.activeOperatorAddress !== undefined
    || profileUpdates.restoreAccessEpoch !== undefined
  if (operatorFieldsTouched && !ensTouched && !profileFieldsTouched) return 'update-operators'
  if (ensTouched && !profileFieldsTouched) {
    const next = (profileUpdates.ensName ?? '').trim()
    if (!next && currentEns) return 'clear-ens'
    return 'update-ens'
  }
  if (profileFieldsTouched) return profilePurpose
  return snapshotPurpose
}

export function rebackupCompletionMessage(
  profileUpdates: ProfileUpdates | undefined,
  identity: EthagentIdentity,
  ensOk?: boolean,
): string {
  if (!profileUpdates) return 'Backup Saved'
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const currentEns = typeof baseState.ensName === 'string' ? baseState.ensName.trim() : ''
  const ensTouched = typeof profileUpdates.ensName === 'string'
  const profileFieldsTouched = profileUpdates.name !== undefined
    || profileUpdates.description !== undefined
    || profileUpdates.imagePath !== undefined
  const operatorFieldsTouched = profileUpdates.ownerAddress !== undefined
    || profileUpdates.approvedOperatorWallets !== undefined
    || profileUpdates.activeOperatorAddress !== undefined
    || profileUpdates.restoreAccessEpoch !== undefined
  if (operatorFieldsTouched && !ensTouched && !profileFieldsTouched) return 'Operator Wallets Updated'
  if (ensTouched && !profileFieldsTouched) {
    const next = (profileUpdates.ensName ?? '').trim()
    if (!next && currentEns) return 'ENS Unlinked'
    if (next) return ensOk === false ? 'ENS Issue' : 'ENS Linked'
    return 'ENS Updated'
  }
  if (profileFieldsTouched) return 'Profile Updated'
  return 'Backup Saved'
}
