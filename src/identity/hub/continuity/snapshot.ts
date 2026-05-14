import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ProfileUpdates } from '../identityHubReducer.js'
import {
  createWalletContinuitySnapshotEnvelope,
  createWalletRestoreAccessKey,
  type ContinuitySnapshotEnvelope,
  type WalletChallengePurpose,
  type WalletContinuityRestoreAccessKey,
} from '../../continuity/envelope.js'
import {
  continuityAgentSnapshot,
  defaultContinuityFiles,
} from '../../continuity/storage.js'
import type { ContinuitySkillsTree } from '../../continuity/envelope.js'
import type { Erc8004RegistryConfig, EthagentOperatorsPointer } from '../../registry/erc8004.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import { readCustodyMode } from '../custody/state.js'
import {
  assertActiveOperatorIsApproved,
  normalizeApprovedOperatorWallets,
} from '../shared/operatorWallets.js'

export type WalletRestoreAccessContext = {
  token: { chainId: number; identityRegistryAddress: Address; agentId: string }
  accessEpoch: number
}

export function expectedAccountForSnapshotSave(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
  walletAccess: WalletRestoreAccessContext | null,
): Address | undefined {
  const ownerAddress = ownerAddressForSnapshotSave(identity, profileUpdates)
  if (snapshotSaveRequiresOwnerSigner(identity, profileUpdates)) return ownerAddress
  if (!walletAccess) return ownerAddress
  if (!hasOwnerRestoreAccessKey(identity)) return ownerAddress
  if (!hasOperatorRestoreAccessKey(identity, profileUpdates)) return ownerAddress
  return undefined
}

export function operatorSignerFor(identity: EthagentIdentity): Address | undefined {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const activeOp = typeof state.activeOperatorAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(state.activeOperatorAddress)
    ? getAddress(state.activeOperatorAddress)
    : undefined
  const approvedRaw = state.approvedOperatorWallets
  const approved: Address[] = Array.isArray(approvedRaw)
    ? (approvedRaw as Array<{ address?: unknown }>)
        .map(r => typeof r?.address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(r.address) ? getAddress(r.address) : undefined)
        .filter((a): a is Address => Boolean(a))
    : []
  const connected = identity.connectedWallet && /^0x[a-fA-F0-9]{40}$/.test(identity.connectedWallet)
    ? getAddress(identity.connectedWallet)
    : undefined
  if (connected) {
    const lower = connected.toLowerCase()
    if (activeOp && activeOp.toLowerCase() === lower) return connected
    if (approved.some(a => a.toLowerCase() === lower)) return connected
  }
  if (activeOp) return activeOp
  if (approved.length > 0) return approved[0]
  return undefined
}

export function operatorWalletCanSignSnapshotSave(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): boolean {
  if (snapshotSaveRequiresOwnerSigner(identity, profileUpdates)) return false
  if (!identity.agentId) return false
  if (!hasOwnerRestoreAccessKey(identity)) return false
  if (!hasOperatorRestoreAccessKey(identity, profileUpdates)) return false
  return true
}

export function snapshotSaveWalletRole(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): 'owner' | 'operator' | 'connected' {
  if (operatorWalletCanSignSnapshotSave(identity, profileUpdates)) return 'operator'
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const approved = profileUpdates?.approvedOperatorWallets !== undefined
    ? normalizeApprovedOperatorWallets(profileUpdates.approvedOperatorWallets)
    : normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  if (approved.length > 0) return 'owner'
  if (readCustodyMode(baseState) === 'advanced') return 'owner'
  return 'connected'
}

export function assertSnapshotSaveSignerAuthorized(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
  signerAddress: Address,
  ownerAddress: Address,
  walletAccess: WalletRestoreAccessContext | null,
): void {
  if (signerAddress.toLowerCase() === ownerAddress.toLowerCase()) return
  if (snapshotSaveRequiresOwnerSigner(identity, profileUpdates) || !walletAccess || !hasOwnerRestoreAccessKey(identity)) {
    throw new Error(`Owner Wallet Required: connected wallet ${signerAddress} does not match owner wallet ${ownerAddress}`)
  }
  const authorized = restoreAccessKeysForSave(identity, profileUpdates)
    .some(key => key.address.toLowerCase() === signerAddress.toLowerCase())
  if (!authorized) {
    throw new Error(`Operator Wallet Required: connected wallet ${signerAddress} is not authorized for this agent`)
  }
}

export function hasOwnerRestoreAccessKey(identity: EthagentIdentity): boolean {
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  return Boolean(readRestoreAccessKey(baseState.ownerRestoreAccessKey))
}

export function snapshotSaveRequiresOwnerSigner(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): boolean {
  if (!profileUpdates) return false
  if (
    profileUpdates.ensName !== undefined
    || profileUpdates.custodyMode !== undefined
    || profileUpdates.ownerAddress !== undefined
    || profileUpdates.approvedOperatorWallets !== undefined
    || profileUpdates.activeOperatorAddress !== undefined
    || profileUpdates.operatorVaultAddress !== undefined
    || profileUpdates.restoreAccessEpoch !== undefined
  ) return true
  const profileFieldChanged =
    profileUpdates.name !== undefined
    || profileUpdates.description !== undefined
    || profileUpdates.imagePath !== undefined
  if (!profileFieldChanged) return false
  return !advancedCustodyEnsAvailable(identity)
}

export function advancedCustodyEnsAvailable(identity: EthagentIdentity): boolean {
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  if (readCustodyMode(baseState) !== 'advanced') return false
  const ensName = typeof baseState.ensName === 'string' ? baseState.ensName.trim() : ''
  if (!ensName) return false
  const approved = normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  return approved.length > 0
}

export function hasOperatorRestoreAccessKey(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): boolean {
  return restoreAccessKeysForSave(identity, profileUpdates)
    .some(key => key.address.toLowerCase() !== ownerAddressForSnapshotSave(identity, profileUpdates).toLowerCase())
}

export function restoreAccessKeysForSave(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): WalletContinuityRestoreAccessKey[] {
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const approved = profileUpdates?.approvedOperatorWallets !== undefined
    ? normalizeApprovedOperatorWallets(profileUpdates.approvedOperatorWallets)
    : normalizeApprovedOperatorWallets(baseState.approvedOperatorWallets)
  return [
    readRestoreAccessKey(baseState.ownerRestoreAccessKey),
    ...approved.flatMap(record => record.restoreAccessKey ? [record.restoreAccessKey] : []),
  ].filter((key): key is WalletContinuityRestoreAccessKey => Boolean(key))
}

export function resolveProfileUpdatesEpoch(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): ProfileUpdates | undefined {
  if (!profileUpdates?.bumpRestoreAccessEpoch) return profileUpdates
  if (profileUpdates.restoreAccessEpoch !== undefined) {
    const { bumpRestoreAccessEpoch: _drop, ...rest } = profileUpdates
    return rest
  }
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const current = readStateSafeInteger(baseState.restoreAccessEpoch) ?? 0
  const { bumpRestoreAccessEpoch: _drop, ...rest } = profileUpdates
  return { ...rest, restoreAccessEpoch: current + 1 }
}

export function walletRestoreAccessContext(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  profileUpdates: ProfileUpdates | undefined,
  _ownerAddress: string,
): WalletRestoreAccessContext | null {
  if (!identity.agentId) return null
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  return {
    token: {
      chainId: registry.chainId,
      identityRegistryAddress: registry.identityRegistryAddress,
      agentId: identity.agentId,
    },
    accessEpoch: profileUpdates?.restoreAccessEpoch
      ?? readStateSafeInteger(baseState.restoreAccessEpoch)
      ?? 1,
  }
}

export function createContinuityEnvelopeForSave(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  signerAddress: Address
  walletSignature: string
  state: Record<string, unknown>
  files: ReturnType<typeof defaultContinuityFiles>
  skills?: ContinuitySkillsTree
  walletAccess: WalletRestoreAccessContext
  challengePurpose?: WalletChallengePurpose
}): ContinuitySnapshotEnvelope {
  const signerIsOwner = args.signerAddress.toLowerCase() === args.ownerAddress.toLowerCase()
  const ownerRestoreAccessKey = signerIsOwner
    ? createWalletRestoreAccessKey({
        token: args.walletAccess.token,
        ownerAddress: args.ownerAddress,
        walletAddress: args.ownerAddress,
        walletSignature: args.walletSignature,
        accessEpoch: args.walletAccess.accessEpoch,
        createdAt: new Date().toISOString(),
        ...(args.challengePurpose ? { purpose: args.challengePurpose } : {}),
      })
    : readRestoreAccessKey(args.state.ownerRestoreAccessKey)
  if (!ownerRestoreAccessKey) {
    throw new Error('Restore Slot Missing: this agent has not been saved by its owner wallet yet. Switch to the owner wallet and save once to authorize operator wallet writes.')
  }
  if (signerIsOwner) args.state.ownerRestoreAccessKey = ownerRestoreAccessKey
  args.state.restoreAccessEpoch = args.walletAccess.accessEpoch
  let signingOperatorKey: WalletContinuityRestoreAccessKey | undefined
  if (!signerIsOwner) {
    signingOperatorKey = createWalletRestoreAccessKey({
      token: args.walletAccess.token,
      ownerAddress: args.ownerAddress,
      walletAddress: args.signerAddress,
      walletSignature: args.walletSignature,
      accessEpoch: args.walletAccess.accessEpoch,
      createdAt: new Date().toISOString(),
      ...(args.challengePurpose ? { purpose: args.challengePurpose } : {}),
    })
  }
  const operatorKeys = normalizeApprovedOperatorWallets(args.state.approvedOperatorWallets)
    .flatMap(record => record.restoreAccessKey ? [record.restoreAccessKey] : [])
    .map(stored =>
      signingOperatorKey && stored.address.toLowerCase() === args.signerAddress.toLowerCase()
        ? signingOperatorKey
        : stored,
    )
  const accessKeys = uniqueRestoreAccessKeys([
    ownerRestoreAccessKey,
    ...operatorKeys,
  ])
  return createWalletContinuitySnapshotEnvelope({
    ownerAddress: args.ownerAddress,
    signerAddress: args.signerAddress,
    signerWalletSignature: args.walletSignature,
    token: args.walletAccess.token,
    accessEpoch: args.walletAccess.accessEpoch,
    accessKeys,
    payload: {
      agent: continuityAgentSnapshot(args.identity),
      files: args.files,
      ...(args.skills && Object.keys(args.skills).length > 0 ? { skills: args.skills } : {}),
      transcript: [],
      state: args.state,
    },
  })
}

export function uniqueRestoreAccessKeys(keys: WalletContinuityRestoreAccessKey[]): WalletContinuityRestoreAccessKey[] {
  const out: WalletContinuityRestoreAccessKey[] = []
  const seen = new Set<string>()
  for (const key of keys) {
    const address = getAddress(key.address)
    const dedupe = address.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push({ ...key, address })
  }
  return out
}

export function readRestoreAccessKey(input: unknown): WalletContinuityRestoreAccessKey | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Partial<WalletContinuityRestoreAccessKey>
  if (typeof obj.address !== 'string' || !isAddress(obj.address, { strict: false })) return undefined
  if (typeof obj.challenge !== 'string' || typeof obj.salt !== 'string' || typeof obj.kemPublicKey !== 'string') return undefined
  return {
    address: getAddress(obj.address),
    challenge: obj.challenge,
    salt: obj.salt,
    kemPublicKey: obj.kemPublicKey,
    ...(typeof obj.createdAt === 'string' ? { createdAt: obj.createdAt } : {}),
  }
}

export function readStateSafeInteger(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0 ? input : undefined
}

export function ownerAddressForSnapshotSave(
  identity: EthagentIdentity,
  profileUpdates: ProfileUpdates | undefined,
): Address {
  const baseState = (identity.state ?? {}) as Record<string, unknown>
  const profileOwnerRaw = typeof profileUpdates?.ownerAddress === 'string' && profileUpdates.ownerAddress.trim()
    ? profileUpdates.ownerAddress.trim()
    : undefined
  const stateOwnerRaw = readOwnerAddressField(baseState)
  const owner = profileOwnerRaw ?? stateOwnerRaw
  if (owner && /^0x[a-fA-F0-9]{40}$/.test(owner)) return getAddress(owner)
  return getAddress(identity.ownerAddress ?? identity.address)
}

export function operatorsPointerFromState(
  state: Record<string, unknown>,
  ensName: string | undefined,
): EthagentOperatorsPointer | undefined {
  const approvedOperatorWallets = normalizeApprovedOperatorWallets(state.approvedOperatorWallets)
  const activeRaw = typeof state.activeOperatorAddress === 'string' ? state.activeOperatorAddress : undefined
  const activeOperatorAddress = activeRaw
    ? assertActiveOperatorIsApproved(approvedOperatorWallets, activeRaw)
    : undefined
  const ownerRaw = readOwnerAddressField(state)
  const ownerAddress = ownerRaw ? getAddress(ownerRaw) : undefined
  const pointerEnsName = ensName ?? (typeof state.ensName === 'string' && state.ensName.trim() ? state.ensName.trim() : undefined)
  const ownerRestoreAccessKey = readRestoreAccessKey(state.ownerRestoreAccessKey)
  const restoreAccessEpoch = readStateSafeInteger(state.restoreAccessEpoch)
  if (approvedOperatorWallets.length === 0 && !activeOperatorAddress && !ownerAddress && !ownerRestoreAccessKey && !restoreAccessEpoch) return undefined
  return {
    approvedOperatorWallets,
    ...(activeOperatorAddress ? { activeOperatorAddress } : {}),
    ...(ownerAddress ? { ownerAddress } : {}),
    ...(pointerEnsName ? { ensName: pointerEnsName } : {}),
    ...(restoreAccessEpoch ? { restoreAccessEpoch } : {}),
    ...(ownerRestoreAccessKey ? { ownerRestoreAccessKey } : {}),
  }
}
