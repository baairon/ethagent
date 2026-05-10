import { getAddress, type Address, type Hex } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
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
import { addToIpfs, DEFAULT_IPFS_API_URL } from '../../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  withEthagentPointers,
} from '../../../registry/erc8004.js'
import {
  OPERATOR_VAULT_ABI,
  encodeRotateAgentURI,
} from '../../../registry/operatorVault.js'
import {
  requestBrowserWalletSignature,
  requestBrowserWalletSignatureAndTransaction,
  type WalletPurpose,
} from '../../../wallet/browserWallet.js'
import type { Step } from '../../identityHubReducer.js'
import type { EffectCallbacks } from '../types.js'
import { awaitConfirmedReceipt } from '../receipts.js'
import {
  assertVerifiedPin,
  prepareProfileStateForSave,
} from '../shared/profilePrep.js'
import {
  assertSnapshotSaveSignerAuthorized,
  createContinuityEnvelopeForSave,
  expectedAccountForSnapshotSave,
  operatorsPointerFromState,
  operatorSignerFor,
  ownerAddressForSnapshotSave,
  type WalletRestoreAccessContext,
  walletRestoreAccessContext,
} from '../shared/snapshot.js'
import { markCurrentContinuityFilesPublished } from '../shared/sync.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type PublicSkillsMetadata = NonNullable<EthagentIdentity['publicSkills']>

type OperatorVaultPublishPrepared = {
  nextIdentity: EthagentIdentity
  markdownScaffold?: IdentityMarkdownScaffold
  completionMessage: string
}

export async function runOperatorWalletRebackup(args: {
  step: Extract<Step, { kind: 'rebackup-signing' }>
  callbacks: EffectCallbacks
  walletPurpose: WalletPurpose
  deriveAgentName: (identity: EthagentIdentity) => string
}): Promise<void> {
  const { step, callbacks } = args
  if (!step.identity.agentId) throw new Error('Cannot back up: identity is missing an agent token ID')
  const sourceAgentId = step.identity.agentId
  const snapshotOwner = ownerAddressForSnapshotSave(step.identity, step.profileUpdates)
  const purpose = args.walletPurpose
  const challengePurpose: WalletChallengePurpose = 'restore-operator'
  const walletAccess = walletRestoreAccessContext(step.identity, step.registry, step.profileUpdates, snapshotOwner)
  if (!walletAccess) throw new Error('Cannot back up: missing wallet restore access context')
  const expectedSigner = expectedAccountForSnapshotSave(step.identity, step.profileUpdates, walletAccess)

  const effectiveSigner = expectedSigner ?? operatorSignerFor(step.identity)
  if (step.vaultAddress && effectiveSigner) {
    await runOperatorWalletVaultPublish({
      step,
      callbacks,
      sourceAgentId,
      snapshotOwner,
      walletAccess,
      challengePurpose,
      expectedSigner: effectiveSigner,
      vaultAddress: step.vaultAddress,
      deriveAgentName: args.deriveAgentName,
    })
    return
  }

  const wallet = await requestBrowserWalletSignature({
    chainId: step.registry.chainId,
    messageForAccount: account => createWalletRestoreAccessChallenge({
      token: walletAccess.token,
      ownerAddress: snapshotOwner,
      walletAddress: account,
      accessEpoch: walletAccess.accessEpoch,
      ...(challengePurpose ? { purpose: challengePurpose } : {}),
    }),
    onReady: callbacks.onWalletReady,
    purpose,
    ...(expectedSigner ? { expectedAccount: expectedSigner } : {}),
  })
  callbacks.onWalletReady(null)

  assertSnapshotSaveSignerAuthorized(step.identity, step.profileUpdates, wallet.account, snapshotOwner, walletAccess)

  const {
    state,
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
    agentId: sourceAgentId,
  }
  const publicSkills: PublicSkillsMetadata = {
    cid: publicSkillsPin.cid,
    agentCardCid: agentCardPin.cid,
    updatedAt: envelope.createdAt,
    status: 'pinned',
  }

  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    state,
    backup,
    publicSkills,
  }

  if (markdownScaffold) {
    await writeIdentityMarkdownScaffold(nextIdentity, markdownScaffold)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'local operator-wallet snapshot' }).catch(() => null)
  await markCurrentContinuityFilesPublished(nextIdentity).catch(() => null)
  const completionMessage = nextEnsName !== undefined && nextEnsName !== ((step.identity.state as Record<string, unknown> | undefined)?.ensName as string | undefined)
    ? 'Snapshot saved locally. Owner wallet still needs to publish to make ENS changes discoverable.'
    : uploadedImageUri !== undefined
      ? 'Snapshot saved locally. Owner wallet still needs to publish to make profile changes discoverable.'
      : 'Snapshot saved locally. Owner wallet still needs to publish to rotate the onchain pointer.'
  await callbacks.onIdentityComplete(nextIdentity, completionMessage, 'update')
}

async function runOperatorWalletVaultPublish(args: {
  step: Extract<Step, { kind: 'rebackup-signing' }>
  callbacks: EffectCallbacks
  sourceAgentId: string
  snapshotOwner: Address
  walletAccess: WalletRestoreAccessContext
  challengePurpose: WalletChallengePurpose | undefined
  expectedSigner: Address
  vaultAddress: Address
  deriveAgentName: (identity: EthagentIdentity) => string
}): Promise<void> {
  const { step, callbacks, sourceAgentId, snapshotOwner, walletAccess, challengePurpose, expectedSigner, vaultAddress } = args

  const probeClient = createErc8004PublicClient(step.registry)
  const isOperator = await probeClient.readContract({
    address: vaultAddress,
    abi: OPERATOR_VAULT_ABI,
    functionName: 'metadataOperators',
    args: [
      getAddress(step.registry.identityRegistryAddress),
      BigInt(sourceAgentId),
      expectedSigner,
    ],
  }) as boolean
  if (!isOperator) {
    throw new Error(
      `Operator wallet ${expectedSigner} is not yet authorized on the OperatorVault to rotate this agent's URI. Connect the owner wallet and run "Fix Records" or re-add this operator to grant the permission.`,
    )
  }

  const result = await requestBrowserWalletSignatureAndTransaction<OperatorVaultPublishPrepared>({
    chainId: step.registry.chainId,
    messageForAccount: account => createWalletRestoreAccessChallenge({
      token: walletAccess.token,
      ownerAddress: snapshotOwner,
      walletAddress: account,
      accessEpoch: walletAccess.accessEpoch,
      ...(challengePurpose ? { purpose: challengePurpose } : {}),
    }),
    onReady: callbacks.onWalletReady,
    purpose: 'rotate-agent-uri-vault-operator',
    ...(step.profileUpdates?.custodyPhase === 'switch-advanced' ? { flowId: 'advanced-custody' } : {}),
    expectedAccount: expectedSigner,
    prepareTransaction: async wallet => {
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

      const publicSkills: PublicSkillsMetadata = {
        cid: publicSkillsPin.cid,
        agentCardCid: agentCardPin.cid,
        updatedAt: envelope.createdAt,
        status: 'pinned',
      }

      const registration = withEthagentPointers({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: nextName ?? args.deriveAgentName(step.identity),
        ...(nextDescription ? { description: nextDescription } : {}),
        ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
      }, {
        backup: { cid: statePin.cid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt },
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

      const vaultCall = encodeRotateAgentURI({
        registry: getAddress(step.registry.identityRegistryAddress),
        agentId: BigInt(sourceAgentId),
        newURI: agentUri,
        vaultAddress,
      })

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
        agentId: sourceAgentId,
        metadataCid,
        agentUri,
      }
      const nextIdentity: EthagentIdentity = {
        ...step.identity,
        state,
        backup,
        publicSkills,
        agentUri,
        metadataCid,
      }

      const completionMessage = nextEnsName !== undefined && nextEnsName !== ((step.identity.state as Record<string, unknown> | undefined)?.ensName as string | undefined)
        ? 'Snapshot published onchain through the OperatorVault. ENS records remain owner-signed, switch to the owner wallet to update them.'
        : 'Snapshot published onchain through the OperatorVault.'

      return {
        to: vaultCall.to,
        data: vaultCall.data,
        prepared: {
          nextIdentity,
          ...(markdownScaffold ? { markdownScaffold } : {}),
          completionMessage,
        },
      }
    },
  })
  callbacks.onWalletReady(null)

  const client = createErc8004PublicClient(step.registry)
  await awaitConfirmedReceipt(
    client,
    result.txHash as Hex,
    'Operator-driven URI rotation through vault',
    { kind: 'rebackup-uri-vault', chainId: step.registry.chainId },
  )

  const nextIdentity = result.prepared.nextIdentity
  if (result.prepared.markdownScaffold) {
    await writeIdentityMarkdownScaffold(nextIdentity, result.prepared.markdownScaffold)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'operator-published snapshot' }).catch(() => null)
  await markCurrentContinuityFilesPublished(nextIdentity).catch(() => null)
  await callbacks.onIdentityComplete(nextIdentity, result.prepared.completionMessage, 'update')
}
