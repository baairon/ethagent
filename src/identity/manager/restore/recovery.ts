import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  assertContinuitySnapshotOwner,
  isWalletContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
  transferSnapshotMetadataFromEnvelope,
} from '../../continuity/envelope.js'
import {
  ensureIdentityMarkdownScaffold,
  localContinuitySnapshotContentHashes,
  restoreSkillsTree,
  writeContinuityFiles,
} from '../../continuity/storage.js'
import { syncAgentCardManifest } from '../../continuity/skills/publicSkillsSync.js'
import { recordPublishedContinuitySnapshot, updatePublishedContinuitySnapshotContentHashes } from '../../continuity/snapshots.js'
import { captureSnapshot, checkpointBeforeRestore } from '../../continuity/snapshotCapture.js'
import { catFromIpfs, DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import {
  discoverOwnedAgentBackupByTokenId,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { requestBrowserWalletSignature, type SignatureRequest } from '../../wallet/browserWallet.js'
import { decryptContinuityWithLocalSigner, type RestoreSigner } from './signer.js'
import { setVaultAddressField } from '../../identityCompat.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { isContinuitySnapshotEnvelope, parseRestorableEnvelope } from './envelopes.js'
import { restoreMessageForWallet } from './auth.js'
import { type BackupMetadata, operatorStateFromCandidate, restorePublishedAgentCard } from './helpers.js'
import { downloadProgress } from './progress.js'

export async function runRecoveryRefetch(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  opts: { signer?: RestoreSigner; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  if (!identity.agentId) throw new Error('Cannot refetch: identity is missing an agent token ID')
  const ownerAddress = getAddress(identity.ownerAddress ?? identity.address)
  const candidate = await discoverOwnedAgentBackupByTokenId({
    ...registry,
    ownerHandle: ownerAddress,
    tokenId: BigInt(identity.agentId),
    ipfsApiUrl: identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    ...(callbacks.signal ? { signal: callbacks.signal } : {}),
  })
  if (!candidate.backup?.cid) {
    throw new Error('The published agent does not have a recoverable encrypted snapshot')
  }
  const apiUrl = identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL
  const raw = await catFromIpfs(apiUrl, candidate.backup.cid, opts.fetchImpl ?? fetch, {
    ...(callbacks.signal ? { signal: callbacks.signal } : {}),
    onProgress: progress => callbacks.onRestoreProgress?.(downloadProgress(progress)),
  })
  callbacks.onRestoreProgress?.(null)
  const envelope = parseRestorableEnvelope(raw)
  if (!isContinuitySnapshotEnvelope(envelope)) {
    throw new Error('This snapshot is in an unsupported envelope format and cannot be refetched here; use Switch Agent')
  }
  const eligibleAddresses: Address[] = [ownerAddress]
  if (isWalletContinuitySnapshotEnvelope(envelope)) {
    for (const slot of envelope.slots) {
      const slotAddress = getAddress(slot.address)
      if (!eligibleAddresses.some(a => a.toLowerCase() === slotAddress.toLowerCase())) {
        eligibleAddresses.push(slotAddress)
      }
    }
  } else {
    assertContinuitySnapshotOwner(envelope, ownerAddress)
  }
  let payload: ReturnType<typeof restoreContinuitySnapshotEnvelope>
  if (opts.signer?.kind === 'local') {
    payload = (await decryptContinuityWithLocalSigner(envelope, opts.signer.signer)).payload
    callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'Decrypting the snapshot…' })
  } else {
    const request: SignatureRequest = {
      chainId: candidate.chainId,
      purpose: 'refetch-snapshot',
      messageForAccount: account => {
        const matched = eligibleAddresses.find(a => a.toLowerCase() === account.toLowerCase())
        if (!matched) {
          throw new Error(`Operator Wallet Required: ${account} is not authorized for this agent. Connect the owner wallet or an authorized operator wallet.`)
        }
        return restoreMessageForWallet(envelope, matched)
      },
    }
    const wallet = opts.signer?.kind === 'browser'
      ? await opts.signer.requestSignature(request)
      : await requestBrowserWalletSignature({
          ...request,
          onReady: callbacks.onWalletReady,
          ...(callbacks.signal ? { signal: callbacks.signal } : {}),
        })
    callbacks.onWalletReady(null)
    callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'Decrypting the snapshot…' })
    payload = restoreContinuitySnapshotEnvelope({
      envelope,
      walletSignature: wallet.signature,
      currentOwnerAddress: getAddress(wallet.account),
    })
  }
  callbacks.onRestoreProgress?.({ phase: 'writing', label: 'Writing soul, memory, and skills…' })
  const transferSnapshot = transferSnapshotMetadataFromEnvelope(envelope)
  const refreshedBackup: BackupMetadata = {
    cid: candidate.backup.cid,
    createdAt: envelope.createdAt,
    envelopeVersion: envelope.envelopeVersion,
    ipfsApiUrl: apiUrl,
    status: 'restored',
    ownerAddress,
    chainId: candidate.chainId,
    rpcUrl: candidate.rpcUrl,
    identityRegistryAddress: candidate.identityRegistryAddress,
    agentId: candidate.agentId.toString(),
    agentUri: candidate.agentUri,
    metadataCid: candidate.metadataCid,
    ...(transferSnapshot ? { transferSnapshot } : {}),
  }
  const refreshedState: Record<string, unknown> = {
    ...payload.state,
    ...(candidate.name ? { name: candidate.name } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    ...operatorStateFromCandidate(candidate),
  }
  const tokenOwnerAddress = candidate.tokenOwnerAddress ?? candidate.ownerAddress
  if (tokenOwnerAddress.toLowerCase() !== candidate.ownerAddress.toLowerCase()) {
    setVaultAddressField(refreshedState, getAddress(tokenOwnerAddress))
  }
  const nextIdentity: EthagentIdentity = {
    ...identity,
    source: 'erc8004',
    address: ownerAddress,
    ownerAddress,
    chainId: candidate.chainId,
    rpcUrl: candidate.rpcUrl,
    identityRegistryAddress: candidate.identityRegistryAddress,
    agentId: candidate.agentId.toString(),
    agentUri: candidate.agentUri,
    metadataCid: candidate.metadataCid,
    state: refreshedState,
    backup: refreshedBackup,
    ...(candidate.publicDiscovery?.agentCardCid ? {
      agentCard: {
        cid: candidate.publicDiscovery.agentCardCid,
        ...(candidate.publicDiscovery.updatedAt ? { updatedAt: candidate.publicDiscovery.updatedAt } : {}),
        status: 'pinned',
      },
    } : {}),
  }
  await checkpointBeforeRestore(nextIdentity, candidate.backup.cid)
  await writeContinuityFiles(nextIdentity, payload.files)
  if (payload.skills) {
    await restoreSkillsTree(nextIdentity, payload.skills)
  }
  callbacks.onRestoreProgress?.({ phase: 'finishing', label: 'Finishing up…' })
  const agentCardRestored = await restorePublishedAgentCard(nextIdentity, apiUrl, candidate.publicDiscovery?.agentCardCid)
  await ensureIdentityMarkdownScaffold(nextIdentity)
  await syncAgentCardManifest(nextIdentity).catch(() => null)
  const { pushVaultSoulMemoryToHarness } = await import('../../../cli/sync.js')
  await pushVaultSoulMemoryToHarness(nextIdentity).catch(() => undefined)
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'refetched latest onchain snapshot' }).catch(() => null)
  await captureSnapshot(nextIdentity, candidate.backup.cid, {
    privateFiles: payload.files,
    agentCard: agentCardRestored,
    ...(payload.skills ? { skills: payload.skills } : {}),
  }, {
    source: 'restore',
    createdAt: envelope.createdAt,
    ...(candidate.publicDiscovery?.agentCardCid ? { agentCardCid: candidate.publicDiscovery.agentCardCid } : {}),
  })
  if (agentCardRestored !== null) {
    const contentHashes = await localContinuitySnapshotContentHashes(nextIdentity)
    await updatePublishedContinuitySnapshotContentHashes(nextIdentity, candidate.backup.cid, contentHashes).catch(() => null)
  }
  await callbacks.onIdentityComplete(nextIdentity, 'Latest snapshot restored from onchain.', 'update')
}
