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
import { catFromIpfs, DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import {
  discoverOwnedAgentBackupByTokenId,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { requestBrowserWalletSignature } from '../../wallet/browserWallet.js'
import { setVaultAddressField } from '../../identityCompat.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { isContinuitySnapshotEnvelope, parseRestorableEnvelope } from './envelopes.js'
import { restoreMessageForWallet } from './auth.js'
import { type BackupMetadata, operatorStateFromCandidate, restorePublishedAgentCard } from './helpers.js'

export async function runRecoveryRefetch(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
): Promise<void> {
  if (!identity.agentId) throw new Error('Cannot refetch: identity is missing an agent token ID')
  const ownerAddress = getAddress(identity.ownerAddress ?? identity.address)
  const candidate = await discoverOwnedAgentBackupByTokenId({
    ...registry,
    ownerHandle: ownerAddress,
    tokenId: BigInt(identity.agentId),
    ipfsApiUrl: identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
  })
  if (!candidate.backup?.cid) {
    throw new Error('The published agent does not have a recoverable encrypted snapshot')
  }
  const apiUrl = identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL
  const raw = await catFromIpfs(apiUrl, candidate.backup.cid)
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
  const wallet = await requestBrowserWalletSignature({
    chainId: candidate.chainId,
    purpose: 'refetch-snapshot',
    messageForAccount: account => {
      const matched = eligibleAddresses.find(a => a.toLowerCase() === account.toLowerCase())
      if (!matched) {
        throw new Error(`Operator Wallet Required: ${account} is not authorized for this agent. Connect the owner wallet or an authorized operator wallet.`)
      }
      return restoreMessageForWallet(envelope, matched)
    },
    onReady: callbacks.onWalletReady,
  })
  callbacks.onWalletReady(null)
  callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'signature received, decrypting onchain snapshot...' })
  const payload = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: wallet.signature,
    currentOwnerAddress: getAddress(wallet.account),
  })
  callbacks.onRestoreProgress?.({ phase: 'writing', label: 'restoring SOUL.md, MEMORY.md, and skills...' })
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
  await writeContinuityFiles(nextIdentity, payload.files)
  if (payload.skills) {
    await restoreSkillsTree(nextIdentity, payload.skills)
  }
  callbacks.onRestoreProgress?.({ phase: 'finishing', label: 'finalizing refreshed identity...' })
  const agentCardRestored = await restorePublishedAgentCard(nextIdentity, apiUrl, candidate.publicDiscovery?.agentCardCid)
  await ensureIdentityMarkdownScaffold(nextIdentity)
  await syncAgentCardManifest(nextIdentity).catch(() => null)
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'Refetched Latest Snapshot From Onchain' }).catch(() => null)
  if (agentCardRestored) {
    const contentHashes = await localContinuitySnapshotContentHashes(nextIdentity)
    await updatePublishedContinuitySnapshotContentHashes(nextIdentity, candidate.backup.cid, contentHashes).catch(() => null)
  }
  await callbacks.onIdentityComplete(nextIdentity, 'Latest Published Snapshot Restored From Onchain', 'update')
}
