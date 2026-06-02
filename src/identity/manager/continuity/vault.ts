import { getAddress, type Address, type Hex } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  prepareSyncedIdentityMarkdownScaffold,
  prepareSyncedSkillsTree,
  readContinuityFiles,
  writeIdentityMarkdownScaffold,
  type IdentityMarkdownScaffold,
} from '../../continuity/storage.js'
import {
  createWalletRestoreAccessChallenge,
  serializeContinuitySnapshotEnvelope,
  type ContinuityFiles,
  type ContinuitySkillsTree,
  type WalletChallengePurpose,
} from '../../continuity/envelope.js'
import {
  syncAgentCardManifest,
} from '../../continuity/skills/publicSkillsSync.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { addToIpfs, DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  withEthagentPointers,
} from '../../registry/erc8004.js'
import {
  VAULT_ABI,
  encodeRotateAgentURI,
} from '../../registry/vault.js'
import {
  requestBrowserWalletSignature,
  requestBrowserWalletSignatureAndTransaction,
  type WalletPurpose,
} from '../../wallet/browserWallet.js'
import type { Step, ProfileUpdates } from '../reducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { awaitConfirmedReceipt } from '../shared/effects/receipts.js'
import {
  assertVerifiedPin,
  prepareProfileStateForSave,
} from '../shared/effects/profilePrep.js'
import {
  assertSnapshotSaveSignerAuthorized,
  createContinuityEnvelopeForSave,
  expectedAccountForSnapshotSave,
  operatorsPointerFromState,
  operatorSignerFor,
  ownerAddressForSnapshotSave,
  type WalletRestoreAccessContext,
  walletRestoreAccessContext,
} from './snapshot.js'
import { markCurrentContinuityFilesPublished } from '../shared/effects/sync.js'
import { readVaultAddressField } from '../../identityCompat.js'
import { readCustodyMode } from '../custody/state.js'

export function operatorPinCompletionMessage(profileUpdates: ProfileUpdates | undefined): string {
  if (profileUpdates?.ensName !== undefined) {
    return 'Snapshot saved locally. Owner wallet still needs to publish to make ENS changes discoverable.'
  }
  if (
    profileUpdates?.imagePath !== undefined
    || profileUpdates?.name !== undefined
    || profileUpdates?.description !== undefined
  ) {
    return 'Snapshot saved locally. Owner wallet still needs to publish to make profile changes discoverable.'
  }
  return 'Snapshot saved locally. Owner wallet still needs to publish to rotate the onchain pointer.'
}

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type AgentCardMetadata = NonNullable<EthagentIdentity['agentCard']>

type VaultPublishPrepared = {
  nextIdentity: EthagentIdentity
  markdownScaffold?: IdentityMarkdownScaffold
  completionMessage: string
  publishedSources: {
    privateFiles: ContinuityFiles
    agentCard: string
    skills: ContinuitySkillsTree
  }
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
  const stateVault = readVaultAddressField(step.identity.state as Record<string, unknown> | undefined)
  const vaultAddress = step.vaultAddress ?? (stateVault ? getAddress(stateVault) : undefined)
  if (vaultAddress && effectiveSigner) {
    await runOperatorWalletVaultPublish({
      step,
      callbacks,
      sourceAgentId,
      snapshotOwner,
      walletAccess,
      challengePurpose,
      expectedSigner: effectiveSigner,
      vaultAddress,
      deriveAgentName: args.deriveAgentName,
    })
    return
  }
  if (readCustodyMode(step.identity.state as Record<string, unknown> | undefined) === 'advanced') {
    throw new Error(
      !vaultAddress
        ? 'Cannot publish this snapshot: advanced custody is configured but the operator vault address could not be resolved. Run `npx ethagent` -> Fix Records to repair the vault link.'
        : 'Cannot publish this snapshot: no authorized operator wallet is available to sign. Connect an approved operator wallet, or run `npx ethagent` -> Fix Records.',
    )
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

  const { state } = await prepareProfileStateForSave({
    identity: step.identity,
    registry: step.registry,
    profileUpdates: step.profileUpdates,
    pinataJwt: step.pinataJwt,
    ownerAddress: snapshotOwner,
    walletAccount: getAddress(wallet.account),
    includeLastBackedUpAt: true,
  })
  const nextIdentityForFiles: EthagentIdentity = { ...step.identity, state }
  const { pullHarnessSoulMemoryIntoVault } = await import('../../../cli/sync.js')
  await pullHarnessSoulMemoryIntoVault(nextIdentityForFiles).catch(() => [])
  const markdownScaffold = step.profileUpdates
    ? await prepareSyncedIdentityMarkdownScaffold(nextIdentityForFiles)
    : undefined
  const continuityFiles = markdownScaffold
    ? { 'SOUL.md': markdownScaffold['SOUL.md'], 'MEMORY.md': markdownScaffold['MEMORY.md'] }
    : await readContinuityFiles(nextIdentityForFiles)
  const agentCardJson = await syncAgentCardManifest(nextIdentityForFiles)
  const agentCardPin = await addToIpfs(DEFAULT_IPFS_API_URL, agentCardJson, fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(agentCardPin)
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
  const agentCard: AgentCardMetadata = {
    cid: agentCardPin.cid,
    updatedAt: envelope.createdAt,
    status: 'pinned',
  }

  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    state,
    backup,
    agentCard,
  }

  if (markdownScaffold) {
    await writeIdentityMarkdownScaffold(nextIdentity, markdownScaffold)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'local operator-wallet snapshot' }).catch(() => null)
  await markCurrentContinuityFilesPublished(nextIdentity, {
    privateFiles: continuityFiles,
    agentCard: agentCardJson,
    skills: skillsTree,
  }).catch(() => null)
  const completionMessage = operatorPinCompletionMessage(step.profileUpdates)
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
    abi: VAULT_ABI,
    functionName: 'metadataOperators',
    args: [
      getAddress(step.registry.identityRegistryAddress),
      BigInt(sourceAgentId),
      expectedSigner,
    ],
  }) as boolean
  if (!isOperator) {
    throw new Error(
      `Operator wallet ${expectedSigner} is not yet authorized on the Vault to rotate this agent's URI. Connect the owner wallet and run "Fix Records" or re-add this operator to grant the permission.`,
    )
  }

  const result = await requestBrowserWalletSignatureAndTransaction<VaultPublishPrepared>({
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
      const { pullHarnessSoulMemoryIntoVault } = await import('../../../cli/sync.js')
      await pullHarnessSoulMemoryIntoVault(nextIdentityForFiles).catch(() => [])
      const markdownScaffold = step.profileUpdates
        ? await prepareSyncedIdentityMarkdownScaffold(nextIdentityForFiles)
        : undefined
      const continuityFiles = markdownScaffold
        ? { 'SOUL.md': markdownScaffold['SOUL.md'], 'MEMORY.md': markdownScaffold['MEMORY.md'] }
        : await readContinuityFiles(nextIdentityForFiles)
      const agentCardJson = await syncAgentCardManifest(nextIdentityForFiles)
      const agentCardPin = await addToIpfs(DEFAULT_IPFS_API_URL, agentCardJson, fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(agentCardPin)
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
        ...(challengePurpose ? { challengePurpose } : {}),
      })
      const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeContinuitySnapshotEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(statePin)

      const agentCard: AgentCardMetadata = {
        cid: agentCardPin.cid,
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
        publicDiscovery: { agentCardCid: agentCard.cid, updatedAt: agentCard.updatedAt },
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
        agentCard,
        agentUri,
        metadataCid,
      }

      const completionMessage = nextEnsName !== undefined && nextEnsName !== ((step.identity.state as Record<string, unknown> | undefined)?.ensName as string | undefined)
        ? 'Snapshot published onchain through the Vault. ENS records remain owner-signed, switch to the owner wallet to update them.'
        : 'Snapshot published onchain through the Vault.'

      return {
        to: vaultCall.to,
        data: vaultCall.data,
        prepared: {
          nextIdentity,
          ...(markdownScaffold ? { markdownScaffold } : {}),
          completionMessage,
          publishedSources: {
            privateFiles: continuityFiles,
            agentCard: agentCardJson,
            skills: skillsTree,
          },
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

  const nextIdentity: EthagentIdentity = result.prepared.nextIdentity.backup
    ? { ...result.prepared.nextIdentity, backup: { ...result.prepared.nextIdentity.backup, txHash: result.txHash } }
    : result.prepared.nextIdentity
  if (result.prepared.markdownScaffold) {
    await writeIdentityMarkdownScaffold(nextIdentity, result.prepared.markdownScaffold)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'operator-published snapshot' }).catch(() => null)
  await markCurrentContinuityFilesPublished(nextIdentity, result.prepared.publishedSources).catch(() => null)
  await callbacks.onIdentityComplete(nextIdentity, result.prepared.completionMessage, 'update')
}
