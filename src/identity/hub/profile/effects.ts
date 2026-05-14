import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  createWalletRestoreAccessChallenge,
  serializeContinuitySnapshotEnvelope,
  type WalletChallengePurpose,
} from '../../continuity/envelope.js'
import {
  prepareSyncedSkillsTree,
  prepareSyncedPublicSkillsJson,
  readContinuityFiles,
  writePublicSkillsFile,
} from '../../continuity/storage.js'
import {
  appendPublicSkillEntries,
  createAgentCard,
  defaultPublicSkillsProfile,
  serializeAgentCard,
} from '../../continuity/publicSkills.js'
import {
  derivePublicSkillEntries,
  syncPublicSkillsManifest,
} from '../../continuity/skills/publicSkillsSync.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { addToIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl } from '../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  encodeSetAgentUri,
  preflightSetAgentUri,
  withEthagentPointers,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import {
  VAULT_ABI,
  encodeRotateAgentURI,
} from '../../registry/vault.js'
import { resolveValidatedPinataJwt, savePinataJwt } from '../../storage/pinataJwt.js'
import {
  openBrowserWalletSession,
  requestBrowserWalletSignatureAndTransaction,
  type BrowserWalletSignature,
  type WalletPurpose,
} from '../../wallet/browserWallet.js'
import type { ProfileUpdates, Step } from '../identityHubReducer.js'
import { acquireTxGuard, releaseTxGuard } from '../shared/txGuard.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { awaitConfirmedReceipt } from '../shared/effects/receipts.js'
import {
  assertVerifiedPin,
  deriveAgentName,
  prepareProfileStateForSave,
  readEnsOkFromState,
} from '../shared/effects/profilePrep.js'
import {
  appendResolverSyncWarning,
  markCurrentContinuityFilesPublished,
  resolverSyncWarningMessage,
  syncVaultOperatorsAfterOwnerSave,
} from '../shared/effects/sync.js'
import {
  assertSnapshotSaveSignerAuthorized,
  createContinuityEnvelopeForSave,
  expectedAccountForSnapshotSave,
  operatorsPointerFromState,
  ownerAddressForSnapshotSave,
  snapshotSaveWalletRole,
  walletRestoreAccessContext,
} from '../continuity/snapshot.js'
import { rebackupCompletionMessage } from '../continuity/effects.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type PublicSkillsMetadata = NonNullable<EthagentIdentity['publicSkills']>

type PublicProfilePreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  publicSkills: PublicSkillsMetadata
  identity: EthagentIdentity
  publicSkillsJson: string
}

export async function runPublicProfilePreflight(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  profileUpdates?: ProfileUpdates,
  returnTo: Step = { kind: 'continuity-public' },
  vaultAddress?: Address,
): Promise<void> {
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({ kind: 'public-profile-storage', identity, registry, error: (err as Error).message, profileUpdates, returnTo, ...(vaultAddress ? { vaultAddress } : {}) })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'public-profile-storage', identity, registry, profileUpdates, returnTo, ...(vaultAddress ? { vaultAddress } : {}) })
    return
  }
  callbacks.onStep({ kind: 'public-profile-signing', identity, registry, pinataJwt: jwt, profileUpdates, returnTo, ...(vaultAddress ? { vaultAddress } : {}) })
}

export async function runPublicProfileSigning(
  step: Extract<Step, { kind: 'public-profile-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  acquireTxGuard('public-profile')
  try {
    return await runPublicProfileSigningInner(step, callbacks)
  } finally {
    releaseTxGuard('public-profile')
  }
}

async function runPublicProfileSigningInner(
  step: Extract<Step, { kind: 'public-profile-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  if (snapshotSaveWalletRole(step.identity, step.profileUpdates) === 'operator') {
    await runOperatorWalletPublicProfileSave(step, callbacks)
    return
  }
  const snapshotOwner = ownerAddressForSnapshotSave(step.identity, step.profileUpdates)
  const walletAccess = walletRestoreAccessContext(step.identity, step.registry, step.profileUpdates, snapshotOwner)
  const expectedSigner = expectedAccountForSnapshotSave(step.identity, step.profileUpdates, walletAccess)
  const profileRole = snapshotSaveWalletRole(step.identity, step.profileUpdates)
  const profilePurpose: WalletPurpose = profileRole === 'operator'
    ? 'update-profile-operator'
    : profileRole === 'owner'
      ? 'update-profile-owner'
      : 'update-profile-connected'
  const result = await requestBrowserWalletSignatureAndTransaction<PublicProfilePreparedTransaction>({
    chainId: step.registry.chainId,
    messageForAccount: account => `Authorize public profile update for agent #${step.identity.agentId ?? 'unknown'} (${account})`,
    onReady: callbacks.onWalletReady,
    purpose: profilePurpose,
    ...(expectedSigner ? { expectedAccount: expectedSigner } : {}),
    prepareTransaction: async wallet => {
      if (!step.identity.agentId) throw new Error('Cannot update public profile: identity is missing an agent token ID')
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
        includeLastBackedUpAt: false,
      })
      const nextIdentityForFiles: EthagentIdentity = { ...step.identity, state }
      const publicSkillsJson = await syncPublicSkillsManifest(nextIdentityForFiles)
      const publicSkillsPin = await addToIpfs(DEFAULT_IPFS_API_URL, publicSkillsJson, fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(publicSkillsPin)
      const agentCardPin = await addToIpfs(
        DEFAULT_IPFS_API_URL,
        serializeAgentCard(createAgentCard(defaultPublicSkillsProfile(nextIdentityForFiles))),
        fetch,
        { pinataJwt: step.pinataJwt },
      )
      assertVerifiedPin(agentCardPin)
      const updatedAt = new Date().toISOString()
      const publicSkills: PublicSkillsMetadata = {
        cid: publicSkillsPin.cid,
        agentCardCid: agentCardPin.cid,
        updatedAt,
        status: 'pinned',
      }
      const existingBackup = step.identity.backup ? {
        cid: step.identity.backup.cid,
        ...(step.identity.backup.envelopeVersion ? { envelopeVersion: step.identity.backup.envelopeVersion } : {}),
        ...(step.identity.backup.createdAt ? { createdAt: step.identity.backup.createdAt } : {}),
      } : undefined
      const registration = withEthagentPointers({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: nextName ?? deriveAgentName(step.identity),
        ...(nextDescription ? { description: nextDescription } : {}),
        ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
      }, {
        backup: existingBackup,
        publicDiscovery: {
          skillsCid: publicSkills.cid,
          agentCardCid: publicSkills.agentCardCid,
          updatedAt,
        },
        registration: {
          chainId: step.registry.chainId,
          identityRegistryAddress: step.registry.identityRegistryAddress,
          agentId: step.identity.agentId,
        },
        ensName: nextEnsName,
        operators: operatorsPointerFromState(state, nextEnsName),
        ownerAddress: snapshotOwner,
      })
      const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(metadataPin)
      const metadataCid = metadataPin.cid
      const agentUri = `ipfs://${metadataCid}`
      const agentId = BigInt(step.identity.agentId)
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
          publicSkills,
          identity: { ...step.identity, state },
          publicSkillsJson,
        },
      }
    },
  })
  const client = createErc8004PublicClient(step.registry)
  await awaitConfirmedReceipt(client, result.txHash, 'Owner-wallet profile save', { kind: 'public-profile', chainId: step.registry.chainId })
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
    publicSkills: result.prepared.publicSkills,
  }
  await writePublicSkillsFile(nextIdentity, result.prepared.publicSkillsJson)
  await markCurrentContinuityFilesPublished(nextIdentity)
  const resolverSyncWarning = await syncVaultOperatorsAfterOwnerSave({
    beforeIdentity: step.identity,
    afterIdentity: nextIdentity,
    registry: step.registry,
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

async function runOperatorWalletPublicProfileSave(
  step: Extract<Step, { kind: 'public-profile-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  if (!step.identity.agentId) throw new Error('Cannot update public profile: identity is missing an agent token ID')
  if (!step.vaultAddress) {
    throw new Error('Operator-wallet profile updates require a Vault. Set one up via Advanced Mode, or connect the owner wallet to update the profile.')
  }
  const snapshotOwner = ownerAddressForSnapshotSave(step.identity, step.profileUpdates)
  const walletAccess = walletRestoreAccessContext(step.identity, step.registry, step.profileUpdates, snapshotOwner)
  if (!walletAccess) throw new Error('Operator-wallet profile updates require wallet restore access context')
  const challengePurpose: WalletChallengePurpose = 'restore-operator'
  await runOperatorWalletVaultPublicProfileSave({
    step,
    callbacks,
    snapshotOwner,
    walletAccess,
    challengePurpose,
    vaultAddress: step.vaultAddress,
  })
}

type WalletAccessContext = NonNullable<ReturnType<typeof walletRestoreAccessContext>>

async function runOperatorWalletVaultPublicProfileSave(args: {
  step: Extract<Step, { kind: 'public-profile-signing' }>
  callbacks: EffectCallbacks
  snapshotOwner: Address
  walletAccess: WalletAccessContext
  challengePurpose: WalletChallengePurpose
  vaultAddress: Address
}): Promise<void> {
  const { step, callbacks, snapshotOwner, walletAccess, challengePurpose, vaultAddress } = args
  const session = await openBrowserWalletSession({ onReady: callbacks.onWalletReady })
  try {
    const wallet = await session.requestSignature({
      chainId: step.registry.chainId,
      messageForAccount: account => createWalletRestoreAccessChallenge({
        token: walletAccess.token,
        ownerAddress: snapshotOwner,
        walletAddress: account,
        accessEpoch: walletAccess.accessEpoch,
        purpose: challengePurpose,
      }),
      purpose: 'update-profile-operator',
      flowId: 'public-profile-vault',
      flowStep: 1,
    })
    assertSnapshotSaveSignerAuthorized(step.identity, step.profileUpdates, wallet.account, snapshotOwner, walletAccess)
    await assertVaultSignerCanRotateAgentUri({
      registry: step.registry,
      vaultAddress,
      agentId: BigInt(step.identity.agentId!),
      signer: wallet.account,
    })

    const prepared = await prepareOperatorProfileArtifacts({
      step,
      wallet,
      snapshotOwner,
      walletAccess,
      challengePurpose,
    })

    const vaultCall = encodeRotateAgentURI({
      registry: getAddress(step.registry.identityRegistryAddress),
      agentId: BigInt(step.identity.agentId!),
      newURI: prepared.agentUri,
      vaultAddress,
    })
    const vaultTx = await session.sendTransaction({
      chainId: step.registry.chainId,
      expectedAccount: wallet.account,
      to: vaultCall.to,
      data: vaultCall.data,
      purpose: 'rotate-agent-uri-vault-operator',
      flowId: 'public-profile-vault',
      flowStep: 2,
    })
    const client = createErc8004PublicClient(step.registry)
    await awaitConfirmedReceipt(
      client,
      vaultTx.txHash,
      'Operator public profile URI rotation through vault',
      { kind: 'public-profile', chainId: step.registry.chainId },
    )

    const nextIdentity: EthagentIdentity = {
      ...prepared.nextIdentity,
      backup: prepared.nextIdentity.backup
        ? { ...prepared.nextIdentity.backup, txHash: vaultTx.txHash }
        : prepared.nextIdentity.backup,
    }
    await writePublicSkillsFile(nextIdentity, prepared.publicSkillsJson)
    await markCurrentContinuityFilesPublished(nextIdentity).catch(() => null)
    await recordPublishedContinuitySnapshot({
      identity: nextIdentity,
      label: 'operator-wallet vaulted profile update',
    }).catch(() => null)

    await callbacks.onIdentityComplete(
      nextIdentity,
      'Profile updated. ERC-8004 metadata published through the Vault.',
      'update',
    )
  } finally {
    await session.close().catch(() => null)
    callbacks.onWalletReady(null)
  }
}

type OperatorProfileArtifacts = {
  nextIdentity: EthagentIdentity
  publicSkillsJson: string
  agentUri: string
  metadataCid: string
}

async function prepareOperatorProfileArtifacts(args: {
  step: Extract<Step, { kind: 'public-profile-signing' }>
  wallet: BrowserWalletSignature
  snapshotOwner: Address
  walletAccess: WalletAccessContext
  challengePurpose: WalletChallengePurpose
}): Promise<OperatorProfileArtifacts> {
  const { step, wallet, snapshotOwner, walletAccess, challengePurpose } = args
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

  const publicSkillsJson = await syncPublicSkillsManifest(nextIdentityForFiles)
  const publicSkillsPin = await addToIpfs(DEFAULT_IPFS_API_URL, publicSkillsJson, fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(publicSkillsPin)
  const publicSkillEntries = await derivePublicSkillEntries(nextIdentityForFiles)
  const augmentedPublicProfile = appendPublicSkillEntries(
    defaultPublicSkillsProfile(nextIdentityForFiles),
    publicSkillEntries,
  )
  const agentCardPin = await addToIpfs(
    DEFAULT_IPFS_API_URL,
    serializeAgentCard(createAgentCard(augmentedPublicProfile)),
    fetch,
    { pinataJwt: step.pinataJwt },
  )
  assertVerifiedPin(agentCardPin)

  const continuityFiles = await readContinuityFiles(nextIdentityForFiles)
  const skillsTree = await prepareSyncedSkillsTree(nextIdentityForFiles)
  const envelope = createContinuityEnvelopeForSave({
    identity: nextIdentityForFiles,
    registry: step.registry,
    ownerAddress: snapshotOwner,
    signerAddress: wallet.account,
    walletSignature: wallet.signature,
    state,
    files: continuityFiles,
    skills: skillsTree,
    walletAccess,
    challengePurpose,
  })
  const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeContinuitySnapshotEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(statePin)

  const publicSkills: PublicSkillsMetadata = {
    cid: publicSkillsPin.cid,
    agentCardCid: agentCardPin.cid,
    updatedAt: envelope.createdAt,
    status: 'pinned',
  }
  const backup: BackupMetadata = {
    cid: statePin.cid,
    createdAt: envelope.createdAt,
    envelopeVersion: envelope.envelopeVersion,
    ipfsApiUrl: DEFAULT_IPFS_API_URL,
    status: 'pinned',
    ownerAddress: snapshotOwner,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: step.identity.agentId!,
  }

  const registration = withEthagentPointers({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: nextName ?? deriveAgentName(step.identity),
    ...(nextDescription ? { description: nextDescription } : {}),
    ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
  }, {
    backup: { cid: statePin.cid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt },
    publicDiscovery: { skillsCid: publicSkills.cid, agentCardCid: publicSkills.agentCardCid, updatedAt: publicSkills.updatedAt },
    registration: { chainId: step.registry.chainId, identityRegistryAddress: step.registry.identityRegistryAddress, agentId: step.identity.agentId },
    ensName: nextEnsName,
    operators: operatorsPointerFromState(state, nextEnsName),
    ownerAddress: snapshotOwner,
  })
  const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  const metadataCid = metadataPin.cid
  const agentUri = `ipfs://${metadataCid}`

  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    state,
    backup: { ...backup, metadataCid, agentUri },
    publicSkills,
    agentUri,
    metadataCid,
  }

  return {
    nextIdentity,
    publicSkillsJson,
    agentUri,
    metadataCid,
  }
}

async function assertVaultSignerCanRotateAgentUri(args: {
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  agentId: bigint
  signer: Address
}): Promise<void> {
  const client = createErc8004PublicClient(args.registry)
  const registryAddress = getAddress(args.registry.identityRegistryAddress)
  const vaultAddress = getAddress(args.vaultAddress)
  const signer = getAddress(args.signer)
  let vaultOwner: Address
  try {
    vaultOwner = getAddress(await client.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'agentOwner',
      args: [registryAddress, args.agentId],
    }) as Address)
  } catch (err: unknown) {
    throw new Error(`Could not verify Vault custody for agent #${args.agentId.toString()}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (vaultOwner === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Vault ${vaultAddress} does not currently hold agent token #${args.agentId.toString()}. Connect the owner wallet and run "Fix Records" or return the token to the vault before retrying.`)
  }
  if (vaultOwner.toLowerCase() === signer.toLowerCase()) return

  const isOperator = await client.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'metadataOperators',
    args: [registryAddress, args.agentId, signer],
  }) as boolean
  if (isOperator) return

  throw new Error(
    `Operator wallet ${signer} is not yet authorized on the Vault to rotate this agent's URI. Connect the owner wallet and run "Fix Records" or re-add this operator to grant the permission.`,
  )
}

export async function runPublicProfileStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'public-profile-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'public-profile-signing', identity: step.identity, registry: step.registry, pinataJwt, profileUpdates: step.profileUpdates, returnTo: step.returnTo, ...(step.vaultAddress ? { vaultAddress: step.vaultAddress } : {}) })
}
