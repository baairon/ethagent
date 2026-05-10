import { getAddress, type Address } from 'viem'
import type { Hex } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
  continuityVaultStatus,
  prepareSyncedIdentityMarkdownScaffold,
  readContinuityFiles,
  readPublicSkillsFile,
  writeIdentityMarkdownScaffold,
  type IdentityMarkdownScaffold,
} from '../../../continuity/storage.js'
import {
  createWalletRestoreAccessChallenge,
  serializeContinuitySnapshotEnvelope,
  type WalletChallengePurpose,
} from '../../../continuity/envelope.js'
import {
  createAgentCard,
  defaultPublicSkillsProfile,
  serializeAgentCard,
} from '../../../continuity/publicSkills.js'
import { recordPublishedContinuitySnapshot } from '../../../continuity/snapshots.js'
import { addToIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl } from '../../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  encodeSetAgentUri,
  preflightSetAgentUri,
  withEthagentPointers,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import { resolveValidatedPinataJwt, savePinataJwt } from '../../../storage/pinataJwt.js'
import {
  requestBrowserWalletSignatureAndTransaction,
  type BrowserWalletSession,
  type BrowserWalletSignature,
  type WalletPurpose,
} from '../../../wallet/browserWallet.js'
import {
  encodeRotateAgentURI,
  isAgentInVault,
} from '../../../registry/operatorVault.js'
import type { Step, ProfileUpdates } from '../../identityHubReducer.js'
import { acquireTxGuard, releaseTxGuard } from '../../txGuard.js'
import type { EffectCallbacks } from '../types.js'
import { awaitConfirmedReceipt } from '../receipts.js'
import {
  assertVerifiedPin,
  deriveAgentName,
  prepareProfileStateForSave,
  readEnsOkFromState,
} from '../shared/profilePrep.js'
import {
  assertSnapshotSaveSignerAuthorized,
  createContinuityEnvelopeForSave,
  expectedAccountForSnapshotSave,
  operatorsPointerFromState,
  ownerAddressForSnapshotSave,
  resolveProfileUpdatesEpoch,
  snapshotSaveWalletRole,
  walletRestoreAccessContext,
} from '../shared/snapshot.js'
import {
  appendResolverSyncWarning,
  markCurrentContinuityFilesPublished,
  resolverSyncWarningMessage,
  syncResolverApprovalsAfterOwnerSave,
} from '../shared/sync.js'
import { runOperatorWalletRebackup } from './operatorVault.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type PublicSkillsMetadata = NonNullable<EthagentIdentity['publicSkills']>

type RebackupPreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  backup: BackupMetadata
  publicSkills: PublicSkillsMetadata
  identity: EthagentIdentity
  markdownScaffold?: IdentityMarkdownScaffold
}

export async function runRebackupPreflight(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  profileUpdates?: ProfileUpdates,
  returnTo: Step = { kind: 'menu' },
  walletPurpose?: WalletPurpose,
  vaultAddress?: `0x${string}`,
): Promise<void> {
  const status = await continuityVaultStatus(identity)
  if (!status.ready) {
    throw new Error('Restore local continuity files before saving an encrypted snapshot')
  }
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({ kind: 'rebackup-storage', identity, registry, error: (err as Error).message, profileUpdates, returnTo, walletPurpose, vaultAddress })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'rebackup-storage', identity, registry, profileUpdates, returnTo, walletPurpose, vaultAddress })
    return
  }
  callbacks.onStep({ kind: 'rebackup-signing', identity, registry, pinataJwt: jwt, profileUpdates, returnTo, walletPurpose, vaultAddress })
}

async function resolveRebackupVaultRoute(args: {
  registry: Erc8004RegistryConfig
  vaultAddress?: Address
  agentId: bigint
  signerAccount: Address
}): Promise<{ vaultAddress: Address } | null> {
  if (!args.vaultAddress) return null
  const client = createErc8004PublicClient(args.registry)
  const status = await isAgentInVault({
    client,
    vaultAddress: args.vaultAddress,
    registry: getAddress(args.registry.identityRegistryAddress),
    agentId: args.agentId,
  })
  if (!status.inVault) return null
  const expected = getAddress(args.signerAccount)
  if (!status.ownerAddress || status.ownerAddress.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `Vault-level owner ${status.ownerAddress ?? 'unknown'} does not match signing wallet ${expected}; cannot rotate agentURI through the vault`,
    )
  }
  return { vaultAddress: getAddress(args.vaultAddress) }
}

export async function runRebackupSigning(
  step: Extract<Step, { kind: 'rebackup-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  acquireTxGuard('rebackup')
  try {
    return await runRebackupSigningInner(step, callbacks)
  } finally {
    releaseTxGuard('rebackup')
  }
}

export async function runRebackupSigningInSession(
  step: Extract<Step, { kind: 'rebackup-signing' }>,
  callbacks: EffectCallbacks,
  session: BrowserWalletSession,
  flow?: { flowId?: string; flowStep?: number },
): Promise<void> {
  acquireTxGuard('rebackup')
  try {
    return await runRebackupSigningInner(step, callbacks, { session, flow })
  } finally {
    releaseTxGuard('rebackup')
  }
}

async function runRebackupSigningInner(
  step: Extract<Step, { kind: 'rebackup-signing' }>,
  callbacks: EffectCallbacks,
  opts?: { session?: BrowserWalletSession; flow?: { flowId?: string; flowStep?: number } },
): Promise<void> {
  const sourceAgentId = step.identity.agentId
  if (!sourceAgentId) throw new Error('Cannot back up: identity is missing an agent token ID')
  const resolvedUpdates = resolveProfileUpdatesEpoch(step.identity, step.profileUpdates)
  step = { ...step, ...(resolvedUpdates !== undefined ? { profileUpdates: resolvedUpdates } : {}) }
  if (snapshotSaveWalletRole(step.identity, step.profileUpdates) === 'operator') {
    await runOperatorWalletRebackup({
      step,
      callbacks,
      walletPurpose: step.walletPurpose ?? rebackupWalletPurpose(step.identity, step.profileUpdates),
      deriveAgentName,
    })
    return
  }
  const snapshotOwner = ownerAddressForSnapshotSave(step.identity, step.profileUpdates)
  const purpose: WalletPurpose = step.walletPurpose
    ?? (step.vaultAddress ? 'rotate-agent-uri-vault-owner' : rebackupWalletPurpose(step.identity, step.profileUpdates))
  const challengePurpose: WalletChallengePurpose = 'restore-owner'
  const walletAccess = walletRestoreAccessContext(step.identity, step.registry, step.profileUpdates, snapshotOwner)
  if (!walletAccess) throw new Error('Cannot back up: missing wallet restore access context')
  const expectedSigner = expectedAccountForSnapshotSave(step.identity, step.profileUpdates, walletAccess)
  const orchestratorFlowId = opts?.flow?.flowId
  const orchestratorFlowStep = opts?.flow?.flowStep
  const effectiveFlowId = orchestratorFlowId
    ?? (step.profileUpdates?.custodyPhase === 'switch-advanced' ? 'advanced-custody' : undefined)
  const requestSpec = {
    chainId: step.registry.chainId,
    messageForAccount: (account: Address) => createWalletRestoreAccessChallenge({
      token: walletAccess.token,
      ownerAddress: snapshotOwner,
      walletAddress: account,
      accessEpoch: walletAccess.accessEpoch,
      ...(challengePurpose ? { purpose: challengePurpose } : {}),
    }),
    purpose,
    ...(effectiveFlowId ? { flowId: effectiveFlowId } : {}),
    ...(typeof orchestratorFlowStep === 'number' ? { flowStep: orchestratorFlowStep } : {}),
    ...(expectedSigner ? { expectedAccount: expectedSigner } : {}),
    prepareTransaction: async (wallet: BrowserWalletSignature) => {
      assertSnapshotSaveSignerAuthorized(step.identity, step.profileUpdates, wallet.account, snapshotOwner, walletAccess)
      const {
        state,
        nextName,
        nextDescription,
        nextEnsName,
        uploadedImageUri,
      } = await prepareProfileStateForSave({
        identity: step.identity,
        registry: step.registry,
        profileUpdates: step.profileUpdates,
        pinataJwt: step.pinataJwt,
        ownerAddress: snapshotOwner,
        walletAccount: getAddress(wallet.account),
        includeLastBackedUpAt: true,
      })
      const nextIdentityForFiles: EthagentIdentity = { ...step.identity, state }
      const markdownScaffold = step.profileUpdates
        ? await prepareSyncedIdentityMarkdownScaffold(nextIdentityForFiles)
        : undefined
      const continuityFiles = markdownScaffold
        ? { 'SOUL.md': markdownScaffold['SOUL.md'], 'MEMORY.md': markdownScaffold['MEMORY.md'] }
        : await readContinuityFiles(nextIdentityForFiles)
      const publicSkillsJson = markdownScaffold
        ? markdownScaffold['skills.json']
        : await readPublicSkillsFile(nextIdentityForFiles)
      const publicSkillsPin = await addToIpfs(DEFAULT_IPFS_API_URL, publicSkillsJson, fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(publicSkillsPin)
      const agentCardPin = await addToIpfs(
        DEFAULT_IPFS_API_URL,
        serializeAgentCard(createAgentCard(defaultPublicSkillsProfile(nextIdentityForFiles))),
        fetch,
        { pinataJwt: step.pinataJwt },
      )
      assertVerifiedPin(agentCardPin)
      const envelope = createContinuityEnvelopeForSave({
        identity: nextIdentityForFiles,
        registry: step.registry,
        ownerAddress: snapshotOwner,
        signerAddress: wallet.account,
        walletSignature: wallet.signature,
        state,
        files: continuityFiles,
        walletAccess,
        ...(challengePurpose ? { challengePurpose } : {}),
      })
      const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeContinuitySnapshotEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(statePin)
      const cid = statePin.cid
      const backup: BackupMetadata = {
        cid,
        createdAt: envelope.createdAt,
        envelopeVersion: envelope.envelopeVersion,
        ipfsApiUrl: DEFAULT_IPFS_API_URL,
        status: 'pinned',
        ownerAddress: snapshotOwner,
        chainId: step.registry.chainId,
        rpcUrl: step.registry.rpcUrl,
        identityRegistryAddress: step.registry.identityRegistryAddress,
        agentId: sourceAgentId,
      }
      const publicSkills: PublicSkillsMetadata = {
        cid: publicSkillsPin.cid,
        agentCardCid: agentCardPin.cid,
        updatedAt: envelope.createdAt,
        status: 'pinned',
      }
      const registration = withEthagentPointers({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: nextName ?? deriveAgentName(step.identity),
        ...(nextDescription ? { description: nextDescription } : {}),
        ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
      }, {
        backup: { cid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt },
        publicDiscovery: { skillsCid: publicSkills.cid, agentCardCid: publicSkills.agentCardCid, updatedAt: publicSkills.updatedAt },
        registration: { chainId: step.registry.chainId, identityRegistryAddress: step.registry.identityRegistryAddress, agentId: sourceAgentId },
        ensName: nextEnsName,
        operators: operatorsPointerFromState(state, nextEnsName),
        ownerAddress: snapshotOwner,
      })
      const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(metadataPin)
      const metadataCid = metadataPin.cid
      const agentUri = `ipfs://${metadataCid}`
      const agentId = BigInt(sourceAgentId)
      const vaultRoute = await resolveRebackupVaultRoute({
        registry: step.registry,
        vaultAddress: step.vaultAddress,
        agentId,
        signerAccount: wallet.account,
      })
      if (vaultRoute) {
        const vaultCall = encodeRotateAgentURI({
          registry: getAddress(step.registry.identityRegistryAddress),
          agentId,
          newURI: agentUri,
          vaultAddress: vaultRoute.vaultAddress,
        })
        return {
          to: vaultCall.to,
          data: vaultCall.data,
          prepared: {
            ownerAddress: snapshotOwner,
            agentUri,
            metadataCid,
            backup: { ...backup, metadataCid, agentUri },
            publicSkills,
            identity: { ...step.identity, state },
            ...(markdownScaffold ? { markdownScaffold } : {}),
          },
        }
      }
      await preflightSetAgentUri({
        ...step.registry,
        account: wallet.account,
        agentId,
        newUri: agentUri,
      })
      return {
        to: step.registry.identityRegistryAddress,
        data: encodeSetAgentUri({ agentId, newUri: agentUri }),
        prepared: {
          ownerAddress: snapshotOwner,
          agentUri,
          metadataCid,
          backup: { ...backup, metadataCid, agentUri },
          publicSkills,
          identity: { ...step.identity, state },
          ...(markdownScaffold ? { markdownScaffold } : {}),
        },
      }
    },
  }
  const result = opts?.session
    ? await opts.session.requestSignatureAndTransaction<RebackupPreparedTransaction>(requestSpec)
    : await requestBrowserWalletSignatureAndTransaction<RebackupPreparedTransaction>({
        ...requestSpec,
        onReady: callbacks.onWalletReady,
      })
  const client = createErc8004PublicClient(step.registry)
  await awaitConfirmedReceipt(client, result.txHash as Hex, 'Agent URI rotation', { kind: step.vaultAddress ? 'rebackup-uri-vault' : 'rebackup-uri', chainId: step.registry.chainId })
  const nextIdentity: EthagentIdentity = {
    ...result.prepared.identity,
    source: 'erc8004',
    address: getAddress(result.prepared.ownerAddress),
    ownerAddress: getAddress(result.prepared.ownerAddress),
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentUri: result.prepared.agentUri,
    metadataCid: result.prepared.metadataCid,
    backup: { ...result.prepared.backup, txHash: result.txHash },
    publicSkills: result.prepared.publicSkills,
  }
  if (result.prepared.markdownScaffold) {
    await writeIdentityMarkdownScaffold(nextIdentity, result.prepared.markdownScaffold)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'published encrypted snapshot' }).catch(() => null)
  await markCurrentContinuityFilesPublished(nextIdentity).catch(() => null)
  const resolverSyncWarning = await syncResolverApprovalsAfterOwnerSave({
    beforeIdentity: step.identity,
    afterIdentity: nextIdentity,
    registry: step.registry,
    ...(step.vaultAddress ? { vaultAddress: step.vaultAddress } : {}),
    callbacks,
  }).then(() => null).catch(err => resolverSyncWarningMessage(err))
  const completionMessage = appendResolverSyncWarning(
    rebackupCompletionMessage(
      step.profileUpdates,
      step.identity,
      readEnsOkFromState(nextIdentity.state),
    ),
    resolverSyncWarning,
  )
  await callbacks.onIdentityComplete(nextIdentity, completionMessage, 'update')
}

export async function runRebackupStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'rebackup-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'rebackup-signing', identity: step.identity, registry: step.registry, pinataJwt, profileUpdates: step.profileUpdates, returnTo: step.returnTo, walletPurpose: step.walletPurpose, vaultAddress: step.vaultAddress })
}

function rebackupWalletPurpose(
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
