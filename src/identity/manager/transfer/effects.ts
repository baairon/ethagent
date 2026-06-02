import { getAddress, isAddress, type Address, type Hex } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  createTransferContinuitySnapshotChallenge,
  createTransferContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
  transferSnapshotMetadataFromEnvelope,
} from '../../continuity/envelope.js'
import {
  continuityAgentSnapshot,
  continuityVaultStatus,
  prepareSyncedSkillsTree,
  readContinuityFiles,
  writeAgentCardFile,
} from '../../continuity/storage.js'
import {
  syncAgentCardManifest,
} from '../../continuity/skills/publicSkillsSync.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { addToIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl } from '../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  encodeSetAgentUri,
  preflightSetAgentUri,
  withEthagentPointers,
} from '../../registry/erc8004.js'
import { resolveValidatedPinataJwt, savePinataJwt } from '../../storage/pinataJwt.js'
import { openBrowserWalletSession } from '../../wallet/browserWallet.js'
import { resolveEnsAddress } from '../../ens/ensLookup.js'
import type { Step } from '../reducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { awaitConfirmedReceipt } from '../shared/effects/receipts.js'
import {
  assertVerifiedPin,
  deriveAgentName,
} from '../shared/effects/profilePrep.js'
import { operatorsPointerFromState } from '../continuity/snapshot.js'
import { tokenTransferProgressForPhase } from './progress.js'
import { assertTokenNotInVault } from '../custody/preflight.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type AgentCardMetadata = NonNullable<EthagentIdentity['agentCard']>

type TokenTransferResult = {
  identity: EthagentIdentity
  snapshotCid: string
  txHash: Hex
}

export async function runTokenTransferTargetSubmit(
  value: string,
  step: Extract<Step, { kind: 'token-transfer-target' }>,
  callbacks: EffectCallbacks,
  options: { signal?: AbortSignal } = {},
): Promise<void> {
  if (!step.identity.agentId) throw new Error('Cannot prepare token transfer: identity is missing an agent token ID')
  const targetHandle = value.trim()
  if (!targetHandle) throw new Error('Enter the receiver wallet ENS name or 0x address')
  throwIfTransferAborted(options.signal)
  await assertTokenNotInVault({ identity: step.identity, registry: step.registry })
  throwIfTransferAborted(options.signal)
  callbacks.onStep({ kind: 'token-transfer-resolving', identity: step.identity, registry: step.registry, targetHandle, returnTo: step.returnTo })
  const targetAddress = await resolveTransferTargetAddress(targetHandle, { signal: options.signal })
  throwIfTransferAborted(options.signal)
  const ownerAddress = getAddress(step.identity.ownerAddress ?? step.identity.address)
  if (targetAddress.toLowerCase() === ownerAddress.toLowerCase()) {
    throw new Error('Receiver wallet must be different from the sender wallet')
  }
  const status = await continuityVaultStatus(step.identity)
  throwIfTransferAborted(options.signal)
  if (!status.ready) {
    throw new Error('Restore local continuity files before preparing a transfer snapshot')
  }
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
    throwIfTransferAborted(options.signal)
  } catch (err: unknown) {
    throwIfTransferAborted(options.signal)
    callbacks.onStep({
      kind: 'token-transfer-storage',
      identity: step.identity,
      registry: step.registry,
      targetHandle,
      targetAddress,
      error: (err as Error).message,
      returnTo: step.returnTo,
    })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    throwIfTransferAborted(options.signal)
    callbacks.onStep({ kind: 'token-transfer-storage', identity: step.identity, registry: step.registry, targetHandle, targetAddress, returnTo: step.returnTo })
    return
  }
  throwIfTransferAborted(options.signal)
  callbacks.onStep({ kind: 'token-transfer-signing', identity: step.identity, registry: step.registry, targetHandle, targetAddress, pinataJwt: jwt, returnTo: step.returnTo })
}

export async function runTokenTransferStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'token-transfer-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({
    kind: 'token-transfer-signing',
    identity: step.identity,
    registry: step.registry,
    targetHandle: step.targetHandle,
    targetAddress: step.targetAddress,
    pinataJwt,
    returnTo: step.returnTo,
  })
}

export async function runTokenTransferSigning(
  step: Extract<Step, { kind: 'token-transfer-signing' }>,
  callbacks: EffectCallbacks,
): Promise<TokenTransferResult> {
  if (!step.identity.agentId) throw new Error('Cannot prepare token transfer: identity is missing an agent token ID')
  const transferAgentId = step.identity.agentId
  const ownerAddress = getAddress(step.identity.ownerAddress ?? step.identity.address)
  const targetAddress = getAddress(step.targetAddress)
  const token = {
    chainId: step.registry.chainId,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: transferAgentId,
  }
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'sender' })
  const targetChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'receiver' })

  const session = await openBrowserWalletSession({ onReady: callbacks.onWalletReady })
  try {

  callbacks.onTokenTransferProgress?.(tokenTransferProgressForPhase('sender-sign', ownerAddress, targetAddress))
  const senderSignature = await session.requestSignature({
    chainId: step.registry.chainId,
    expectedAccount: ownerAddress,
    message: senderChallenge,
    purpose: 'prepare-transfer-sender',
  })

  callbacks.onTokenTransferProgress?.(tokenTransferProgressForPhase('target-sign', ownerAddress, targetAddress))
  const targetSignature = await session.requestSignature({
    chainId: step.registry.chainId,
    expectedAccount: targetAddress,
    message: targetChallenge,
    purpose: 'prepare-transfer-target',
  })

  callbacks.onTokenTransferProgress?.(tokenTransferProgressForPhase('pinning', ownerAddress, targetAddress))
  const baseState = (step.identity.state ?? {}) as Record<string, unknown>
  const state: Record<string, unknown> = {
    ...baseState,
    ownerAddress,
    lastBackedUpAt: new Date().toISOString(),
  }
  const nextIdentityForFiles: EthagentIdentity = { ...step.identity, state }
  const { pullHarnessSoulMemoryIntoVault } = await import('../../../cli/sync.js')
  await pullHarnessSoulMemoryIntoVault(nextIdentityForFiles).catch(() => [])
  const continuityFiles = await readContinuityFiles(nextIdentityForFiles)
  const agentCardJson = await syncAgentCardManifest(nextIdentityForFiles)
  const agentCardPin = await addToIpfs(DEFAULT_IPFS_API_URL, agentCardJson, fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(agentCardPin)
  const skillsTree = await prepareSyncedSkillsTree(nextIdentityForFiles)
  const envelope = createTransferContinuitySnapshotEnvelope({
    ownerAddress,
    ownerWalletSignature: senderSignature.signature,
    targetAddress,
    targetWalletSignature: targetSignature.signature,
    targetHandle: step.targetHandle,
    token,
    payload: {
      agent: continuityAgentSnapshot(nextIdentityForFiles),
      files: continuityFiles,
      ...(Object.keys(skillsTree).length > 0 ? { skills: skillsTree } : {}),
      transcript: [],
      state,
    },
  })
  const transferSnapshot = transferSnapshotMetadataFromEnvelope(envelope)
  const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeContinuitySnapshotEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(statePin)
  const snapshotCid = statePin.cid
  const backup: BackupMetadata = {
    cid: snapshotCid,
    createdAt: envelope.createdAt,
    envelopeVersion: envelope.envelopeVersion,
    ipfsApiUrl: DEFAULT_IPFS_API_URL,
    status: 'pinned',
    ownerAddress,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: transferAgentId,
    ...(transferSnapshot ? { transferSnapshot } : {}),
  }
  const agentCard: AgentCardMetadata = {
    cid: agentCardPin.cid,
    updatedAt: envelope.createdAt,
    status: 'pinned',
  }
  const nextName = typeof state.name === 'string' && state.name.trim() ? state.name.trim() : deriveAgentName(step.identity)
  const nextDescription = typeof state.description === 'string' && state.description.trim() ? state.description.trim() : ''
  const uploadedImageUri = typeof state.imageUrl === 'string' && state.imageUrl.trim() ? state.imageUrl.trim() : undefined
  const nextEnsName = typeof state.ensName === 'string' && state.ensName.trim() ? state.ensName.trim() : undefined
  const registration = withEthagentPointers({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: nextName,
    ...(nextDescription ? { description: nextDescription } : {}),
    ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
  }, {
    backup: { cid: snapshotCid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt, ...(transferSnapshot ? { transferSnapshot } : {}) },
    publicDiscovery: { agentCardCid: agentCard.cid, updatedAt: agentCard.updatedAt },
    registration: { chainId: step.registry.chainId, identityRegistryAddress: step.registry.identityRegistryAddress, agentId: transferAgentId },
    ensName: nextEnsName,
    operators: operatorsPointerFromState(state, nextEnsName),
    ownerAddress,
  })
  const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  const metadataCid = metadataPin.cid
  const agentUri = `ipfs://${metadataCid}`
  const agentId = BigInt(transferAgentId)
  await preflightSetAgentUri({
    ...step.registry,
    account: ownerAddress,
    agentId,
    newUri: agentUri,
  })

  callbacks.onTokenTransferProgress?.(tokenTransferProgressForPhase('sender-transaction', ownerAddress, targetAddress))
  const tx = await session.sendTransaction({
    chainId: step.registry.chainId,
    expectedAccount: ownerAddress,
    to: step.registry.identityRegistryAddress,
    data: encodeSetAgentUri({ agentId, newUri: agentUri }),
    purpose: 'publish-transfer-snapshot',
  })

  callbacks.onTokenTransferProgress?.(tokenTransferProgressForPhase('confirming', ownerAddress, targetAddress))
  const client = createErc8004PublicClient(step.registry)
  await awaitConfirmedReceipt(client, tx.txHash, 'Token transfer URI publish', { kind: 'token-transfer', chainId: step.registry.chainId })
  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    source: 'erc8004',
    address: ownerAddress,
    ownerAddress,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentUri,
    metadataCid,
    backup: { ...backup, metadataCid, agentUri, txHash: tx.txHash },
    agentCard,
    state,
  }
  await writeAgentCardFile(nextIdentity, agentCardJson)
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'published transfer snapshot' }).catch(() => null)
  callbacks.onTokenTransferProgress?.(null)
  return {
    identity: nextIdentity,
    snapshotCid,
    txHash: tx.txHash,
  }

  } finally {
    await session.close().catch(() => {})
    callbacks.onWalletReady(null)
  }
}

async function resolveTransferTargetAddress(value: string, options: { signal?: AbortSignal } = {}): Promise<Address> {
  const trimmed = value.trim()
  throwIfTransferAborted(options.signal)
  if (isAddress(trimmed, { strict: false })) return getAddress(trimmed)
  if (!trimmed.includes('.')) throw new Error('Enter a receiver Ethereum address or ENS name')
  const resolved = await resolveEnsAddress(trimmed, { signal: options.signal })
  throwIfTransferAborted(options.signal)
  if (!resolved) throw new Error(`ENS name did not resolve: ${trimmed}`)
  return getAddress(resolved)
}

function throwIfTransferAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const err = new Error('token transfer preparation cancelled')
  err.name = 'AbortError'
  throw err
}

export { tokenTransferProgressForPhase } from './progress.js'
