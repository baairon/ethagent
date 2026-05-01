import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Address, Hex } from 'viem'
import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../../storage/config.js'
import { saveConfig } from '../../storage/config.js'
import {
  assertAgentStateBackupOwner,
  parseAgentStateBackupEnvelope,
  restoreAgentStateBackupEnvelope,
} from '../crypto/backupEnvelope.js'
import {
  CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
  assertContinuitySnapshotOwner,
  createContinuitySnapshotChallenge,
  createContinuitySnapshotEnvelope,
  parseContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
  type ContinuitySnapshotEnvelope,
} from '../continuity/envelope.js'
import {
  continuityAgentSnapshot,
  continuityVaultStatus,
  defaultContinuityFiles,
  ensurePublicSkillsFile,
  ensureIdentityMarkdownScaffold,
  ensureContinuityFiles,
  continuitySnapshotContentHashes,
  equalContinuitySnapshotHashes,
  localContinuitySnapshotContentHashes,
  prepareSyncedIdentityMarkdownScaffold,
  prepareSyncedPublicSkillsJson,
  readContinuityFiles,
  readPublicSkillsFile,
  writeContinuityFiles,
  writeIdentityMarkdownScaffold,
  writePublicSkillsFile,
  type IdentityMarkdownScaffold,
} from '../continuity/storage.js'
import {
  createAgentCard,
  defaultPublicSkillsProfile,
  renderPublicSkillsJson,
  serializeAgentCard,
} from '../continuity/publicSkills.js'
import {
  recordPublishedContinuitySnapshot,
  updatePublishedContinuitySnapshotContentHashes,
} from '../continuity/snapshots.js'
import { addFileToIpfs, addToIpfs, catFromIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl, type IpfsAddResult } from '../storage/ipfs.js'
import {
  AgentTokenIdRequiredError,
  chainIdForNetwork,
  createErc8004PublicClient,
  discoverOwnedAgentBackups,
  discoverOwnedAgentBackupByTokenId,
  encodeRegisterAgent,
  encodeSetAgentUri,
  erc8004ConfigForSupportedChain,
  normalizeErc8004RegistryConfig,
  preflightRegisterAgent,
  preflightSetAgentUri,
  registeredAgentFromReceipt,
  withEthagentBackupPointer,
  withEthagentPointers,
  type Erc8004AgentCandidate,
  type Erc8004RegistryConfig,
} from '../registry/erc8004.js'
import { getAddress } from 'viem'
import { registryConfigFromConfig, type RegistryResolution } from '../registry/registryConfig.js'
import { resolveValidatedPinataJwt, savePinataJwt } from '../storage/pinataJwt.js'
import {
  requestBrowserWalletAccount,
  requestBrowserWalletSignature,
  requestBrowserWalletSignatureAndTransaction,
  sendBrowserWalletTransaction,
  type BrowserWalletReady,
} from '../wallet/browserWallet.js'
import { initialAgentState, PREFLIGHT_AGENT_URI } from './identityHubModel.js'
import type { Step, ProfileUpdates, RestorePurpose } from './identityHubReducer.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type PublicSkillsMetadata = NonNullable<EthagentIdentity['publicSkills']>

type CreatePreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  backup: BackupMetadata
  publicSkills: PublicSkillsMetadata
  state: Record<string, unknown>
  continuityFiles: ReturnType<typeof defaultContinuityFiles>
  publicSkillsJson: string
}

type RebackupPreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  backup: BackupMetadata
  publicSkills: PublicSkillsMetadata
  identity: EthagentIdentity
  markdownScaffold?: IdentityMarkdownScaffold
}

type PublicProfilePreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  publicSkills: PublicSkillsMetadata
  identity: EthagentIdentity
  publicSkillsJson: string
}

export type EffectCallbacks = {
  onStep: (step: Step) => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onIdentityComplete: (identity: EthagentIdentity, message: string) => Promise<void>
  onRestoreProgress?: (progress: RestoreProgress | null) => void
}

export type RestoreProgress = {
  phase: 'decrypting' | 'writing' | 'finishing'
  label: string
}

export async function runCreatePreflight(
  step: Extract<Step, { kind: 'create-preflight' }>,
  config: EthagentConfig | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const resolution = step.network
    ? registryResolutionForNetwork(step.network)
    : registryConfigFromConfig(config)
  if (!resolution.config) {
    callbacks.onStep({ kind: 'create-registry', name: step.name, description: step.description, resolution })
    return
  }
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({
      kind: 'create-storage',
      name: step.name,
      description: step.description,
      registry: resolution.config,
      error: (err as Error).message,
    })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry: resolution.config })
    return
  }
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: resolution.config, pinataJwt: jwt })
}

function registryResolutionForNetwork(network: SelectableNetwork): RegistryResolution {
  const chainId = chainIdForNetwork(network)
  try {
    const registry = erc8004ConfigForSupportedChain(chainId)
    return {
      config: registry,
      network,
      chainId,
      needsRegistryAddress: false,
      defaultRpcUrl: registry.rpcUrl,
    }
  } catch {
    return {
      config: null,
      network,
      chainId,
      needsRegistryAddress: true,
      defaultRpcUrl: '',
    }
  }
}

export async function runCreateSigning(
  step: Extract<Step, { kind: 'create-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const result = await requestBrowserWalletSignatureAndTransaction<CreatePreparedTransaction>({
    chainId: step.registry.chainId,
    messageForAccount: account => createContinuitySnapshotChallenge(account),
    onReady: callbacks.onWalletReady,
    prepareTransaction: async wallet => {
      await preflightRegisterAgent({
        ...step.registry,
        ownerAddress: wallet.account,
        agentURI: PREFLIGHT_AGENT_URI,
      })
      const state = initialAgentState(step.name, step.description, wallet.account)
      const draftIdentity = identityDraftForBackup({
        ownerAddress: wallet.account,
        registry: step.registry,
        state,
      })
      const continuityFiles = defaultContinuityFiles(draftIdentity)
      const publicProfile = defaultPublicSkillsProfile(draftIdentity)
      const publicSkillsJson = renderPublicSkillsJson(publicProfile)
      const publicSkillsPin = await addToIpfs(DEFAULT_IPFS_API_URL, publicSkillsJson, fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(publicSkillsPin)
      const agentCardPin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeAgentCard(createAgentCard(publicProfile)), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(agentCardPin)
      const envelope = createContinuitySnapshotEnvelope({
        ownerAddress: wallet.account,
        walletSignature: wallet.signature,
        payload: {
          agent: continuityAgentSnapshot(draftIdentity),
          files: continuityFiles,
          transcript: [],
          state,
        },
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
        ownerAddress: wallet.account,
        chainId: step.registry.chainId,
        rpcUrl: step.registry.rpcUrl,
        identityRegistryAddress: step.registry.identityRegistryAddress,
      }
      const publicSkills: PublicSkillsMetadata = {
        cid: publicSkillsPin.cid,
        agentCardCid: agentCardPin.cid,
        updatedAt: envelope.createdAt,
        status: 'pinned',
      }
      const registration = withEthagentBackupPointer({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: step.name,
        ...(step.description ? { description: step.description } : {}),
        ...(typeof state.imageUrl === 'string' ? { image: state.imageUrl } : {}),
      }, {
        cid,
        envelopeVersion: envelope.envelopeVersion,
        createdAt: envelope.createdAt,
      }, {
        skillsCid: publicSkills.cid,
        agentCardCid: publicSkills.agentCardCid,
        updatedAt: publicSkills.updatedAt,
      }, {
        chainId: step.registry.chainId,
        identityRegistryAddress: step.registry.identityRegistryAddress,
      })
      const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
      assertVerifiedPin(metadataPin)
      const metadataCid = metadataPin.cid
      const agentUri = `ipfs://${metadataCid}`
      return {
        to: step.registry.identityRegistryAddress,
        data: encodeRegisterAgent({ agentURI: agentUri }),
        prepared: {
          ownerAddress: wallet.account,
          agentUri,
          metadataCid,
          backup: { ...backup, metadataCid, agentUri },
          publicSkills,
          state,
          continuityFiles,
          publicSkillsJson,
        },
      }
    },
  })
  const client = createErc8004PublicClient(step.registry)
  const receipt = await client.waitForTransactionReceipt({ hash: result.txHash })
  const registered = registeredAgentFromReceipt({
    logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics] as Hex[], data: log.data })),
    identityRegistryAddress: step.registry.identityRegistryAddress,
    ownerAddress: result.prepared.ownerAddress,
  })
  const backup: BackupMetadata = {
    ...result.prepared.backup,
    agentId: registered.agentId.toString(),
    agentUri: registered.agentURI,
    txHash: result.txHash,
  }
  const nextIdentity: EthagentIdentity = {
    source: 'erc8004',
    address: result.prepared.ownerAddress,
    ownerAddress: result.prepared.ownerAddress,
    createdAt: result.prepared.backup.createdAt,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: registered.agentId.toString(),
    agentUri: registered.agentURI,
    metadataCid: result.prepared.metadataCid,
    state: result.prepared.state,
    backup,
    publicSkills: result.prepared.publicSkills,
  }
  await writeIdentityMarkdownScaffold(nextIdentity, {
    ...defaultContinuityFiles(nextIdentity),
    'skills.json': result.prepared.publicSkillsJson,
  })
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'initial published snapshot' }).catch(() => null)
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent registered · #${registered.agentId.toString()}`)
}

export async function runRestoreDiscover(
  step: Extract<Step, { kind: 'restore-discovering' }>,
  _config: EthagentConfig | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const candidates = await discoverOwnedAgentBackups({
    ...step.registry,
    ownerHandle: step.ownerHandle,
    ipfsApiUrl: DEFAULT_IPFS_API_URL,
  })
  callbacks.onStep(restoreTokenSelectionStep({
    ownerHandle: step.ownerHandle,
    registry: step.registry,
    candidates,
    purpose: step.purpose,
  }))
}

export async function runRestoreConnectWallet(
  step: Extract<Step, { kind: 'restore-wallet' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const wallet = await requestBrowserWalletAccount({
    onReady: callbacks.onWalletReady,
  })
  callbacks.onStep({ kind: 'restore-network', ownerHandle: wallet.account, purpose: step.purpose })
}

export function restoreTokenSelectionStep(args: {
  ownerHandle: string
  registry: Erc8004RegistryConfig
  candidates: Erc8004AgentCandidate[]
  purpose?: RestorePurpose
}): Extract<Step, { kind: 'restore-select-token' }> {
  const restorable = args.candidates.filter(candidate => candidate.backup?.cid)
  if (restorable.length === 0) {
    throw new Error(args.candidates.length === 0
      ? 'no agent identities owned by that wallet on this network'
      : 'no owned agent identity has recoverable ethagent state on this network')
  }
  return {
    kind: 'restore-select-token',
    ownerHandle: args.ownerHandle,
    registry: args.registry,
    candidates: restorable,
    purpose: args.purpose,
  }
}

export function isAgentTokenIdRequiredError(err: unknown): err is AgentTokenIdRequiredError {
  return err instanceof AgentTokenIdRequiredError
}

export async function runRestoreTokenIdSubmit(
  value: string,
  step: Extract<Step, { kind: 'restore-token-id' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const tokenId = parseTokenId(value)
  const candidate = await discoverOwnedAgentBackupByTokenId({
    ...step.registry,
    ownerHandle: step.ownerHandle,
    tokenId,
    ipfsApiUrl: DEFAULT_IPFS_API_URL,
  })
  if (!candidate.backup?.cid) {
    throw new Error('that agent token does not have recoverable ethagent state')
  }
  callbacks.onStep({
    kind: 'restore-fetching',
    cid: candidate.backup.cid,
    apiUrl: DEFAULT_IPFS_API_URL,
    candidate,
    purpose: step.purpose,
  })
}

function parseTokenId(value: string): bigint {
  const normalized = value.trim().replace(/^#/, '')
  if (!/^\d+$/.test(normalized)) throw new Error('enter a token id')
  return BigInt(normalized)
}

export async function runRestoreFetch(
  step: Extract<Step, { kind: 'restore-fetching' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const raw = await catFromIpfs(step.apiUrl, step.cid)
  const envelope = parseRestorableEnvelope(raw)
  if (isContinuitySnapshotEnvelope(envelope)) {
    assertContinuitySnapshotOwner(envelope, step.candidate.ownerAddress)
  } else {
    assertAgentStateBackupOwner(envelope, step.candidate.ownerAddress)
  }
  callbacks.onStep({ kind: 'restore-authorizing', cid: step.cid, apiUrl: step.apiUrl, envelope, candidate: step.candidate, purpose: step.purpose })
}

export async function runRestoreAuthorize(
  step: Extract<Step, { kind: 'restore-authorizing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const wallet = await requestBrowserWalletSignature({
    chainId: step.candidate.chainId,
    expectedAccount: step.candidate.ownerAddress,
    message: step.envelope.challenge,
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
  }
  const nextIdentity: EthagentIdentity = {
    source: 'erc8004',
    address: step.candidate.ownerAddress,
    ownerAddress: step.candidate.ownerAddress,
    createdAt: restored.createdAt,
    chainId: step.candidate.chainId,
    rpcUrl: step.candidate.rpcUrl,
    identityRegistryAddress: step.candidate.identityRegistryAddress,
    agentId: step.candidate.agentId.toString(),
    agentUri: step.candidate.agentUri,
    metadataCid: step.candidate.metadataCid,
    state: {
      ...restored.state,
      ...(step.candidate.name ? { name: step.candidate.name } : {}),
      ...(step.candidate.description ? { description: step.candidate.description } : {}),
      ...(step.candidate.imageUrl ? { imageUrl: step.candidate.imageUrl } : {}),
    },
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
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent restored · #${step.candidate.agentId.toString()}`)
}

export async function runRegistrySubmit(
  value: string,
  step: Extract<Step, { kind: 'create-registry' }>,
  config: EthagentConfig | undefined,
  onConfigChange: ((config: EthagentConfig) => void) | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const registry = normalizeErc8004RegistryConfig({
    chainId: step.resolution.chainId,
    rpcUrl: step.resolution.defaultRpcUrl,
    identityRegistryAddress: value.trim(),
  })
  if (config && onConfigChange) {
    const next: EthagentConfig = {
      ...config,
      erc8004: {
        chainId: registry.chainId,
        rpcUrl: registry.rpcUrl,
        identityRegistryAddress: registry.identityRegistryAddress,
      },
    }
    await saveConfig(next)
    onConfigChange(next)
  }
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry, error: (err as Error).message })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry })
    return
  }
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry, pinataJwt: jwt })
}

export async function runRestoreRegistrySubmit(
  value: string,
  step: Extract<Step, { kind: 'restore-registry' }>,
  config: EthagentConfig | undefined,
  onConfigChange: ((config: EthagentConfig) => void) | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const resolution = registryConfigFromConfig(config)
  const registry = normalizeErc8004RegistryConfig({
    chainId: resolution.chainId,
    rpcUrl: resolution.config?.rpcUrl ?? resolution.defaultRpcUrl,
    identityRegistryAddress: value.trim(),
  })
  if (config && onConfigChange) {
    const next: EthagentConfig = {
      ...config,
      erc8004: {
        chainId: registry.chainId,
        rpcUrl: registry.rpcUrl,
        identityRegistryAddress: registry.identityRegistryAddress,
      },
    }
    await saveConfig(next)
    onConfigChange(next)
  }
  callbacks.onStep({ kind: 'restore-discovering', ownerHandle: step.ownerHandle, registry, purpose: step.purpose })
}

export async function runStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'create-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: step.registry, pinataJwt })
}

export async function runRebackupPreflight(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  profileUpdates?: ProfileUpdates,
  returnTo: Step = { kind: 'menu' },
): Promise<void> {
  const status = await continuityVaultStatus(identity)
  if (!status.ready) {
    throw new Error('restore local SOUL.md and MEMORY.md working files before saving an encrypted snapshot')
  }
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({ kind: 'rebackup-storage', identity, registry, error: (err as Error).message, profileUpdates, returnTo })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'rebackup-storage', identity, registry, profileUpdates, returnTo })
    return
  }
  callbacks.onStep({ kind: 'rebackup-signing', identity, registry, pinataJwt: jwt, profileUpdates, returnTo })
}

export async function runRebackupSigning(
  step: Extract<Step, { kind: 'rebackup-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const expectedOwner = step.identity.ownerAddress ?? step.identity.address
  const result = await requestBrowserWalletSignatureAndTransaction<RebackupPreparedTransaction>({
    chainId: step.registry.chainId,
    messageForAccount: account => createContinuitySnapshotChallenge(account),
    onReady: callbacks.onWalletReady,
    ...(expectedOwner ? { expectedAccount: getAddress(expectedOwner) } : {}),
    prepareTransaction: async wallet => {
      if (!step.identity.agentId) throw new Error('cannot back up: identity is missing an agent token id')
      if (expectedOwner && wallet.account.toLowerCase() !== expectedOwner.toLowerCase()) {
        throw new Error(`connect the wallet that owns this agent (${expectedOwner}) and try again`)
      }
      const baseState = (step.identity.state ?? {}) as Record<string, unknown>
      const profile = step.profileUpdates ?? {}
      const nextName = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : (typeof baseState.name === 'string' ? baseState.name : undefined)
      const nextDescription = profile.description !== undefined ? profile.description.trim() : (typeof baseState.description === 'string' ? baseState.description : '')
      const uploadedImageUri = profile.imagePath === 'delete'
        ? ''
        : profile.imagePath
          ? await uploadAgentImage(profile.imagePath, step.pinataJwt)
          : typeof baseState.imageUrl === 'string' && baseState.imageUrl.trim()
            ? baseState.imageUrl.trim()
            : undefined
      const state: Record<string, unknown> = {
        ...baseState,
        ...(nextName !== undefined ? { name: nextName } : {}),
        description: nextDescription,
        lastBackedUpAt: new Date().toISOString(),
      }
      if (uploadedImageUri === '') {
        delete state.imageUrl
      } else if (uploadedImageUri) {
        state.imageUrl = uploadedImageUri
      }
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
      const envelope = createContinuitySnapshotEnvelope({
        ownerAddress: wallet.account,
        walletSignature: wallet.signature,
        payload: {
          agent: continuityAgentSnapshot(nextIdentityForFiles),
          files: continuityFiles,
          transcript: [],
          state,
        },
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
        ownerAddress: wallet.account,
        chainId: step.registry.chainId,
        rpcUrl: step.registry.rpcUrl,
        identityRegistryAddress: step.registry.identityRegistryAddress,
        agentId: step.identity.agentId,
      }
      const publicSkills: PublicSkillsMetadata = {
        cid: publicSkillsPin.cid,
        agentCardCid: agentCardPin.cid,
        updatedAt: envelope.createdAt,
        status: 'pinned',
      }
      const registration = withEthagentBackupPointer({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: nextName ?? deriveAgentName(step.identity),
        ...(nextDescription ? { description: nextDescription } : {}),
        ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
      }, {
        cid,
        envelopeVersion: envelope.envelopeVersion,
        createdAt: envelope.createdAt,
      }, {
        skillsCid: publicSkills.cid,
        agentCardCid: publicSkills.agentCardCid,
        updatedAt: publicSkills.updatedAt,
      }, {
        chainId: step.registry.chainId,
        identityRegistryAddress: step.registry.identityRegistryAddress,
        agentId: step.identity.agentId,
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
          ownerAddress: wallet.account,
          agentUri,
          metadataCid,
          backup: { ...backup, metadataCid, agentUri },
          publicSkills,
          identity: { ...step.identity, state },
          ...(markdownScaffold ? { markdownScaffold } : {}),
        },
      }
    },
  })
  const client = createErc8004PublicClient(step.registry)
  await client.waitForTransactionReceipt({ hash: result.txHash })
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
  const completionMessage = step.profileUpdates ? 'profile updated and backup saved' : 'agent backup saved'
  await callbacks.onIdentityComplete(nextIdentity, completionMessage)
}

export async function runRebackupStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'rebackup-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'rebackup-signing', identity: step.identity, registry: step.registry, pinataJwt, profileUpdates: step.profileUpdates, returnTo: step.returnTo })
}

export async function runPublicProfilePreflight(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  profileUpdates?: ProfileUpdates,
  returnTo: Step = { kind: 'continuity-public' },
): Promise<void> {
  const apiUrl = DEFAULT_IPFS_API_URL
  let jwt: string | undefined
  try {
    jwt = isPinataUploadUrl(apiUrl) ? await resolveValidatedPinataJwt() : undefined
  } catch (err: unknown) {
    callbacks.onStep({ kind: 'public-profile-storage', identity, registry, error: (err as Error).message, profileUpdates, returnTo })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'public-profile-storage', identity, registry, profileUpdates, returnTo })
    return
  }
  callbacks.onStep({ kind: 'public-profile-signing', identity, registry, pinataJwt: jwt, profileUpdates, returnTo })
}

export async function runPublicProfileSigning(
  step: Extract<Step, { kind: 'public-profile-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const expectedOwner = getAddress(step.identity.ownerAddress ?? step.identity.address)
  if (!step.identity.agentId) throw new Error('cannot publish public profile: identity is missing an agent token id')

  const prepared = await preparePublicProfileTransaction(step, expectedOwner)
  const agentId = BigInt(step.identity.agentId)
  await preflightSetAgentUri({
    ...step.registry,
    account: expectedOwner,
    agentId,
    newUri: prepared.agentUri,
  })

  const tx = await sendBrowserWalletTransaction({
    chainId: step.registry.chainId,
    expectedAccount: expectedOwner,
    to: step.registry.identityRegistryAddress,
    data: encodeSetAgentUri({ agentId, newUri: prepared.agentUri }),
    onReady: callbacks.onWalletReady,
  })
  const client = createErc8004PublicClient(step.registry)
  await client.waitForTransactionReceipt({ hash: tx.txHash })

  const nextIdentity: EthagentIdentity = {
    ...prepared.identity,
    source: 'erc8004',
    address: getAddress(prepared.ownerAddress),
    ownerAddress: getAddress(prepared.ownerAddress),
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentUri: prepared.agentUri,
    metadataCid: prepared.metadataCid,
    publicSkills: prepared.publicSkills,
  }
  await writePublicSkillsFile(nextIdentity, prepared.publicSkillsJson)
  await callbacks.onIdentityComplete(nextIdentity, step.profileUpdates ? 'public profile updated' : 'public profile published')
}

export async function runPublicProfileStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'public-profile-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({
    kind: 'public-profile-signing',
    identity: step.identity,
    registry: step.registry,
    pinataJwt,
    profileUpdates: step.profileUpdates,
    returnTo: step.returnTo,
  })
}

export async function runContinuityUnlock(
  step: Extract<Step, { kind: 'continuity-unlocking' }>,
  callbacks: Pick<EffectCallbacks, 'onStep' | 'onWalletReady'>,
): Promise<void> {
  const identity = step.identity
  const ownerAddress = getAddress(identity.ownerAddress ?? identity.address)
  const chainId = identity.chainId ?? identity.backup?.chainId ?? 1
  const snapshotCid = step.cid ?? identity.backup?.cid
  if (snapshotCid) {
    const raw = await catFromIpfs(identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL, snapshotCid)
    const envelope = parseRestorableEnvelope(raw)
    if (isContinuitySnapshotEnvelope(envelope)) {
      assertContinuitySnapshotOwner(envelope, ownerAddress)
      const wallet = await requestBrowserWalletSignature({
        chainId,
        expectedAccount: ownerAddress,
        message: envelope.challenge,
        onReady: callbacks.onWalletReady,
      })
      const payload = restoreContinuitySnapshotEnvelope({ envelope, walletSignature: wallet.signature })
      await writeContinuityFiles({ ...identity, state: payload.state }, payload.files)
      await restorePublishedPublicSkills(identity, identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL, step.publicSkillsCid)
      callbacks.onStep({ kind: 'continuity-private', notice: 'published snapshot restored locally. review, then publish when ready.' })
      return
    }
    assertAgentStateBackupOwner(envelope, ownerAddress)
    const wallet = await requestBrowserWalletSignature({
      chainId,
      expectedAccount: ownerAddress,
      message: envelope.challenge,
      onReady: callbacks.onWalletReady,
    })
    restoreAgentStateBackupEnvelope({ envelope, walletSignature: wallet.signature })
  } else {
    const wallet = await requestBrowserWalletSignature({
      chainId,
      expectedAccount: ownerAddress,
      message: createContinuitySnapshotChallenge(ownerAddress),
      onReady: callbacks.onWalletReady,
    })
    void wallet.signature
  }
  await ensureContinuityFiles(identity)
  callbacks.onStep({ kind: 'continuity-private', notice: 'local private working files are ready on this machine.' })
}


export async function runRecoveryRefetch(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
): Promise<void> {
  if (!identity.agentId) throw new Error('cannot refetch: identity is missing an agent token id')
  const ownerAddress = getAddress(identity.ownerAddress ?? identity.address)
  const candidate = await discoverOwnedAgentBackupByTokenId({
    ...registry,
    ownerHandle: ownerAddress,
    tokenId: BigInt(identity.agentId),
    ipfsApiUrl: identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
  })
  if (!candidate.backup?.cid) {
    throw new Error('the published agent does not have a recoverable encrypted snapshot')
  }
  const apiUrl = identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL
  const raw = await catFromIpfs(apiUrl, candidate.backup.cid)
  const envelope = parseRestorableEnvelope(raw)
  if (!isContinuitySnapshotEnvelope(envelope)) {
    throw new Error('on-chain backup is in a legacy format and cannot be refetched here; use switch agent')
  }
  assertContinuitySnapshotOwner(envelope, ownerAddress)
  const wallet = await requestBrowserWalletSignature({
    chainId: candidate.chainId,
    expectedAccount: ownerAddress,
    message: envelope.challenge,
    onReady: callbacks.onWalletReady,
  })
  callbacks.onWalletReady(null)
  callbacks.onRestoreProgress?.({ phase: 'decrypting', label: 'signature received · decrypting on-chain snapshot...' })
  const payload = restoreContinuitySnapshotEnvelope({ envelope, walletSignature: wallet.signature })
  callbacks.onRestoreProgress?.({ phase: 'writing', label: 'overwriting local SOUL.md, MEMORY.md, skills.json...' })
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
    state: {
      ...payload.state,
      ...(candidate.name ? { name: candidate.name } : {}),
      ...(candidate.description ? { description: candidate.description } : {}),
      ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    },
    backup: refreshedBackup,
    ...(candidate.publicDiscovery ? {
      publicSkills: {
        ...(candidate.publicDiscovery.skillsCid ? { cid: candidate.publicDiscovery.skillsCid } : {}),
        ...(candidate.publicDiscovery.agentCardCid ? { agentCardCid: candidate.publicDiscovery.agentCardCid } : {}),
        ...(candidate.publicDiscovery.updatedAt ? { updatedAt: candidate.publicDiscovery.updatedAt } : {}),
        status: 'pinned',
      },
    } : {}),
  }
  await writeContinuityFiles(nextIdentity, payload.files)
  callbacks.onRestoreProgress?.({ phase: 'finishing', label: 'finalizing refreshed identity...' })
  await restorePublishedPublicSkills(nextIdentity, apiUrl, candidate.publicDiscovery?.skillsCid)
  await ensureIdentityMarkdownScaffold(nextIdentity)
  await recordPublishedContinuitySnapshot({ identity: nextIdentity, label: 'refetched latest snapshot from chain' }).catch(() => null)
  await callbacks.onIdentityComplete(nextIdentity, 'latest published snapshot restored from chain')
}


async function preparePublicProfileTransaction(
  step: Extract<Step, { kind: 'public-profile-signing' }>,
  ownerAddress: Address,
): Promise<PublicProfilePreparedTransaction> {
  const baseState = (step.identity.state ?? {}) as Record<string, unknown>
  const profile = step.profileUpdates ?? {}
  const nextName = typeof profile.name === 'string' && profile.name.trim()
    ? profile.name.trim()
    : (typeof baseState.name === 'string' && baseState.name.trim() ? baseState.name.trim() : deriveAgentName(step.identity))
  const nextDescription = profile.description !== undefined
    ? profile.description.trim()
    : (typeof baseState.description === 'string' ? baseState.description : '')
  const uploadedImageUri = profile.imagePath === 'delete'
    ? ''
    : profile.imagePath
      ? await uploadAgentImage(profile.imagePath, step.pinataJwt)
      : typeof baseState.imageUrl === 'string' && baseState.imageUrl.trim()
        ? baseState.imageUrl.trim()
        : undefined
  const updatedAt = new Date().toISOString()
  const state: Record<string, unknown> = {
    ...baseState,
    name: nextName,
    description: nextDescription,
    publicProfileUpdatedAt: updatedAt,
  }
  if (uploadedImageUri === '') {
    delete state.imageUrl
  } else if (uploadedImageUri) {
    state.imageUrl = uploadedImageUri
  }
  const nextIdentityForFiles: EthagentIdentity = { ...step.identity, state }
  const publicSkillsJson = step.profileUpdates
    ? await prepareSyncedPublicSkillsJson(nextIdentityForFiles)
    : await ensurePublicSkillsFile(nextIdentityForFiles)
  const publicSkillsPin = await addToIpfs(DEFAULT_IPFS_API_URL, publicSkillsJson, fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(publicSkillsPin)
  const agentCardPin = await addToIpfs(
    DEFAULT_IPFS_API_URL,
    serializeAgentCard(createAgentCard(defaultPublicSkillsProfile(nextIdentityForFiles))),
    fetch,
    { pinataJwt: step.pinataJwt },
  )
  assertVerifiedPin(agentCardPin)
  const publicSkills: PublicSkillsMetadata = {
    cid: publicSkillsPin.cid,
    agentCardCid: agentCardPin.cid,
    updatedAt,
    status: 'pinned',
  }
  const backup = step.identity.backup
  const registration = withEthagentPointers({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: nextName,
    ...(nextDescription ? { description: nextDescription } : {}),
    ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
  }, {
    ...(backup ? {
      backup: {
        cid: backup.cid,
        envelopeVersion: backup.envelopeVersion,
        createdAt: backup.createdAt,
      },
    } : {}),
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
  })
  const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  return {
    ownerAddress,
    agentUri: `ipfs://${metadataPin.cid}`,
    metadataCid: metadataPin.cid,
    publicSkills,
    identity: { ...step.identity, state },
    publicSkillsJson,
  }
}

function deriveAgentName(identity: EthagentIdentity): string {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const name = typeof state.name === 'string' ? state.name.trim() : ''
  if (name) return name
  return identity.agentId ? `agent #${identity.agentId}` : 'unnamed agent'
}

async function uploadAgentImage(imagePath: string, pinataJwt: string | undefined): Promise<string> {
  const file = resolveImagePath(imagePath)
  const data = await fs.readFile(file)
  const contentType = imageContentType(file)
  const pin = await addFileToIpfs(DEFAULT_IPFS_API_URL, data, path.basename(file), contentType, fetch, { pinataJwt })
  assertVerifiedPin(pin)
  return `ipfs://${pin.cid}`
}

function resolveImagePath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('image file path is empty')
  if (/^https?:\/\//i.test(trimmed) || /^ipfs:\/\//i.test(trimmed)) {
    throw new Error('enter a local image file path; ethagent uploads it to IPFS')
  }
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(trimmed)) {
    throw new Error('agent image must be png, jpg, gif, webp, or svg')
  }
  return path.resolve(trimmed.replace(/^~(?=$|[\\/])/, os.homedir()))
}

function imageContentType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      throw new Error('agent image must be png, jpg, gif, webp, or svg')
  }
}

function assertVerifiedPin(pin: IpfsAddResult, expectedCid?: string): void {
  if (expectedCid && pin.cid !== expectedCid) throw new Error('IPFS pin verification did not match the published CID')
  if (!pin.pinVerified) throw new Error(`IPFS pin was not verified for ${pin.cid}`)
}

function parseRestorableEnvelope(raw: string | Uint8Array): ReturnType<typeof parseAgentStateBackupEnvelope> | ContinuitySnapshotEnvelope {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  const parsed = JSON.parse(text) as { envelopeVersion?: unknown }
  if (parsed.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION) {
    return parseContinuitySnapshotEnvelope(text)
  }
  return parseAgentStateBackupEnvelope(text)
}

function isContinuitySnapshotEnvelope(envelope: ReturnType<typeof parseRestorableEnvelope>): envelope is ContinuitySnapshotEnvelope {
  return envelope.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
}

function identityDraftForBackup(args: {
  ownerAddress: Address
  registry: Erc8004RegistryConfig
  state: Record<string, unknown>
}): EthagentIdentity {
  return {
    source: 'erc8004',
    address: args.ownerAddress,
    ownerAddress: args.ownerAddress,
    createdAt: typeof args.state.createdAt === 'string' ? args.state.createdAt : new Date().toISOString(),
    chainId: args.registry.chainId,
    rpcUrl: args.registry.rpcUrl,
    identityRegistryAddress: args.registry.identityRegistryAddress,
    agentUri: PREFLIGHT_AGENT_URI,
    state: args.state,
  }
}

async function restorePublishedPublicSkills(
  identity: EthagentIdentity,
  apiUrl: string,
  cid: string | undefined,
): Promise<void> {
  if (!cid) return
  try {
    const raw = await catFromIpfs(apiUrl, cid)
    await writePublicSkillsFile(identity, new TextDecoder().decode(raw))
  } catch {
    // Public skills are recoverable from IPFS later and must not block private restore.
  }
}
