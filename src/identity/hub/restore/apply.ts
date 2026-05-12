import { getAddress } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import { restoreAgentStateBackupEnvelope } from '../../crypto/backupEnvelope.js'
import {
  restoreContinuitySnapshotEnvelope,
  transferSnapshotMetadataFromEnvelope,
} from '../../continuity/envelope.js'
import { ensureIdentityMarkdownScaffold, writeContinuityFiles } from '../../continuity/storage.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { requestBrowserWalletSignature } from '../../wallet/browserWallet.js'
import { setVaultAddressField } from '../../identityCompat.js'
import type { Step } from '../identityHubReducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { isContinuitySnapshotEnvelope } from './envelopes.js'
import { restoreSignatureRequestForStep } from './auth.js'
import { type BackupMetadata, operatorStateFromCandidate, restorePublishedPublicSkills } from './helpers.js'

export async function runRestoreAuthorize(
  step: Extract<Step, { kind: 'restore-authorizing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const signatureRequest = restoreSignatureRequestForStep(step)
  const wallet = await requestBrowserWalletSignature({
    chainId: step.candidate.chainId,
    expectedAccount: signatureRequest.expectedAccount,
    message: signatureRequest.message,
    purpose: signatureRequest.purpose,
    onReady: callbacks.onWalletReady,
  })
  callbacks.onWalletReady(null)
  callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'signature received · decrypting encrypted snapshot...' })
  let restored: ReturnType<typeof restoreAgentStateBackupEnvelope> | ReturnType<typeof restoreContinuitySnapshotEnvelope>
  let continuityFiles: ReturnType<typeof restoreContinuitySnapshotEnvelope>['files'] | undefined
  if (isContinuitySnapshotEnvelope(step.envelope)) {
    const payload = restoreContinuitySnapshotEnvelope({
      envelope: step.envelope,
      walletSignature: wallet.signature,
      currentOwnerAddress: wallet.account,
    })
    restored = payload
    continuityFiles = payload.files
  } else {
    restored = restoreAgentStateBackupEnvelope({
      envelope: step.envelope,
      walletSignature: wallet.signature,
    })
  }
  callbacks.onRestoreProgress?.({ phase: 'writing', label: 'restoring local agent files...' })
  const transferSnapshot = isContinuitySnapshotEnvelope(step.envelope)
    ? transferSnapshotMetadataFromEnvelope(step.envelope)
    : null
  const backup: BackupMetadata = {
    cid: step.cid,
    createdAt: step.envelope.createdAt,
    envelopeVersion: step.envelope.envelopeVersion,
    ipfsApiUrl: step.apiUrl,
    status: 'restored',
    ownerAddress: step.candidate.ownerAddress,
    chainId: step.candidate.chainId,
    rpcUrl: step.candidate.rpcUrl,
    identityRegistryAddress: step.candidate.identityRegistryAddress,
    agentId: step.candidate.agentId.toString(),
    agentUri: step.candidate.agentUri,
    metadataCid: step.candidate.metadataCid,
    ...(transferSnapshot ? { transferSnapshot } : {}),
  }
  const restoreRequester = step.requesterAddress && /^0x[a-fA-F0-9]{40}$/.test(step.requesterAddress)
    ? getAddress(step.requesterAddress)
    : step.candidate.ownerAddress
  const tokenOwnerAddress = step.candidate.tokenOwnerAddress ?? step.candidate.ownerAddress
  const restoredState: Record<string, unknown> = {
    ...restored.state,
    ...(step.candidate.name ? { name: step.candidate.name } : {}),
    ...(step.candidate.description ? { description: step.candidate.description } : {}),
    ...(step.candidate.imageUrl ? { imageUrl: step.candidate.imageUrl } : {}),
    ...operatorStateFromCandidate(step.candidate),
  }
  if (tokenOwnerAddress.toLowerCase() !== step.candidate.ownerAddress.toLowerCase()) {
    setVaultAddressField(restoredState, getAddress(tokenOwnerAddress))
  }
  const nextIdentity: EthagentIdentity = {
    source: 'erc8004',
    address: tokenOwnerAddress,
    ownerAddress: step.candidate.ownerAddress,
    connectedWallet: restoreRequester,
    createdAt: restored.createdAt,
    chainId: step.candidate.chainId,
    rpcUrl: step.candidate.rpcUrl,
    identityRegistryAddress: step.candidate.identityRegistryAddress,
    agentId: step.candidate.agentId.toString(),
    agentUri: step.candidate.agentUri,
    metadataCid: step.candidate.metadataCid,
    state: restoredState,
    backup,
    ...(step.candidate.publicDiscovery ? {
      publicSkills: {
        ...(step.candidate.publicDiscovery.skillsCid ? { cid: step.candidate.publicDiscovery.skillsCid } : {}),
        ...(step.candidate.publicDiscovery.agentCardCid ? { agentCardCid: step.candidate.publicDiscovery.agentCardCid } : {}),
        ...(step.candidate.publicDiscovery.updatedAt ? { updatedAt: step.candidate.publicDiscovery.updatedAt } : {}),
        status: 'pinned',
      },
    } : {}),
  }
  if (continuityFiles) {
    await writeContinuityFiles(nextIdentity, continuityFiles)
  }
  callbacks.onRestoreProgress?.({ phase: 'finishing', label: 'finalizing restored identity...' })
  await restorePublishedPublicSkills(nextIdentity, step.apiUrl, step.candidate.publicDiscovery?.skillsCid)
  await ensureIdentityMarkdownScaffold(nextIdentity)
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'restored from agent backup' }).catch(() => null)
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent restored · #${step.candidate.agentId.toString()}`, 'restore')
}
