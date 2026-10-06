import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import { restoreAgentStateBackupEnvelope } from '../../crypto/backupEnvelope.js'
import {
  restoreContinuitySnapshotEnvelope,
  transferSnapshotMetadataFromEnvelope,
} from '../../continuity/envelope.js'
import {
  ensureIdentityMarkdownScaffold,
  restoreSkillsTree,
  writeContinuityFiles,
} from '../../continuity/storage.js'
import { syncAgentCardManifest } from '../../continuity/skills/publicSkillsSync.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { captureSnapshot, checkpointBeforeRestore } from '../../continuity/snapshotCapture.js'
import { requestBrowserWalletSignature, type SignatureRequest } from '../../wallet/browserWallet.js'
import type { ContinuitySnapshotEnvelope } from '../../continuity/envelope.js'
import { decryptContinuityWithLocalSigner, signLegacyChallengeLocally, type RestoreSigner } from './signer.js'
import { canRestoreCandidate } from './discover.js'
import { setVaultAddressField } from '../../identityCompat.js'
import type { Step } from '../reducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { isContinuitySnapshotEnvelope } from './envelopes.js'
import { restoreMessageForWallet, restoreSignatureRequestForStep } from './auth.js'
import { type BackupMetadata, operatorStateFromCandidate, restorePublishedAgentCard } from './helpers.js'

export async function runRestoreAuthorize(
  step: Extract<Step, { kind: 'restore-authorizing' }>,
  callbacks: EffectCallbacks,
  opts: { signer?: RestoreSigner } = {},
): Promise<void> {
  let restored: ReturnType<typeof restoreAgentStateBackupEnvelope> | ReturnType<typeof restoreContinuitySnapshotEnvelope>
  let continuityFiles: ReturnType<typeof restoreContinuitySnapshotEnvelope>['files'] | undefined
  let continuitySkills: ReturnType<typeof restoreContinuitySnapshotEnvelope>['skills']
  let signerAccount: Address
  if (opts.signer?.kind === 'local') {
    // The operator key answers the challenge locally: no browser, and the snapshot
    // opens only if it carries a slot for that key.
    if (isContinuitySnapshotEnvelope(step.envelope)) {
      const opened = await decryptContinuityWithLocalSigner(step.envelope, opts.signer.signer)
      restored = opened.payload
      continuityFiles = opened.payload.files
      continuitySkills = opened.payload.skills
      signerAccount = opened.account
    } else {
      const envelope = step.envelope
      const opened = await signLegacyChallengeLocally(opts.signer.signer, envelope.challenge, signature =>
        restoreAgentStateBackupEnvelope({ envelope, walletSignature: signature }))
      restored = opened.value
      signerAccount = opened.account
    }
    callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'Decrypting the snapshot…' })
  } else {
    const requestSignature = opts.signer?.kind === 'browser'
      ? opts.signer.requestSignature
      : (req: SignatureRequest) => requestBrowserWalletSignature({
          ...req,
          onReady: callbacks.onWalletReady,
          ...(callbacks.signal ? { signal: callbacks.signal } : {}),
        })
    // Without a known requester and with a continuity snapshot, whichever wallet
    // connects is asked for its own slot's challenge and checked afterwards.
    const openRequest = !step.requesterAddress && isContinuitySnapshotEnvelope(step.envelope)
    const envelopeForRequest = step.envelope
    const signatureRequest = openRequest ? null : restoreSignatureRequestForStep(step)
    const wallet = await requestSignature({
      chainId: step.candidate.chainId,
      ...(signatureRequest
        ? { expectedAccount: signatureRequest.expectedAccount, message: signatureRequest.message, purpose: signatureRequest.purpose }
        : {
            purpose: 'restore-owner-wallet',
            messageForAccount: (account: Address) => {
              if (!canRestoreCandidate(step.candidate, account)) {
                throw new Error(`${account} is not this agent's owner or an approved operator wallet. Connect one of those.`)
              }
              return restoreMessageForWallet(envelopeForRequest as ContinuitySnapshotEnvelope, account)
            },
          }),
    })
    callbacks.onWalletReady(null)
    signerAccount = getAddress(wallet.account)
    callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'Decrypting the snapshot…' })
    if (isContinuitySnapshotEnvelope(step.envelope)) {
      const payload = restoreContinuitySnapshotEnvelope({
        envelope: step.envelope,
        walletSignature: wallet.signature,
        currentOwnerAddress: wallet.account,
      })
      restored = payload
      continuityFiles = payload.files
      continuitySkills = payload.skills
    } else {
      restored = restoreAgentStateBackupEnvelope({
        envelope: step.envelope,
        walletSignature: wallet.signature,
      })
    }
  }
  callbacks.onRestoreProgress?.({ phase: 'writing', label: 'Writing soul, memory, and skills…' })
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
    : signerAccount
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
    ...(step.candidate.publicDiscovery?.agentCardCid ? {
      agentCard: {
        cid: step.candidate.publicDiscovery.agentCardCid,
        ...(step.candidate.publicDiscovery.updatedAt ? { updatedAt: step.candidate.publicDiscovery.updatedAt } : {}),
        status: 'pinned',
      },
    } : {}),
  }
  if (continuityFiles) {
    await checkpointBeforeRestore(nextIdentity, step.cid)
    await writeContinuityFiles(nextIdentity, continuityFiles)
  }
  if (continuitySkills) {
    await restoreSkillsTree(nextIdentity, continuitySkills)
  }
  callbacks.onRestoreProgress?.({ phase: 'finishing', label: 'Finishing up…' })
  const restoredCard = await restorePublishedAgentCard(nextIdentity, step.apiUrl, step.candidate.publicDiscovery?.agentCardCid)
  await ensureIdentityMarkdownScaffold(nextIdentity)
  await syncAgentCardManifest(nextIdentity).catch(() => null)
  if (continuityFiles) {
    const { pushVaultSoulMemoryToHarness } = await import('../../../cli/sync.js')
    await pushVaultSoulMemoryToHarness(nextIdentity).catch(() => undefined)
  }
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'restored from agent backup' }).catch(() => null)
  if (continuityFiles) {
    await captureSnapshot(nextIdentity, step.cid, {
      privateFiles: continuityFiles,
      agentCard: restoredCard,
      ...(continuitySkills ? { skills: continuitySkills } : {}),
    }, {
      source: 'restore',
      createdAt: step.envelope.createdAt,
      ...(step.candidate.publicDiscovery?.agentCardCid ? { agentCardCid: step.candidate.publicDiscovery.agentCardCid } : {}),
    })
  }
  const restoredName = step.candidate.name?.trim()
  const tokenLabel = `token #${step.candidate.agentId.toString()}`
  await callbacks.onIdentityComplete(
    nextIdentity,
    `${restoredName ? `${restoredName} (${tokenLabel})` : `Agent ${tokenLabel}`} is ready on this machine.`,
    'restore',
  )
}
