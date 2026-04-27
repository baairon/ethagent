import type { Address, Hex } from 'viem'
import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../storage/config.js'
import { saveConfig } from '../storage/config.js'
import {
  assertAgentStateSnapshotOwner,
  createAgentStateBackupEnvelope,
  createAgentStateRecoveryChallenge,
  parseAgentStateBackupEnvelope,
  restoreAgentStateBackupEnvelope,
  serializeAgentStateBackupEnvelope,
} from './backupEnvelope.js'
import { addToIpfs, catFromIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl, type IpfsAddResult } from './ipfs.js'
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
  type Erc8004AgentCandidate,
  type Erc8004RegistryConfig,
} from './erc8004.js'
import { getAddress } from 'viem'
import { registryConfigFromConfig, type RegistryResolution } from './registryConfig.js'
import { resolvePinataJwt, savePinataJwt } from './pinataJwt.js'
import {
  requestBrowserWalletAccount,
  requestBrowserWalletSignature,
  sendBrowserWalletTransaction,
  type BrowserWalletReady,
  type BrowserWalletSignature,
} from './browserWallet.js'
import { initialAgentState, PREFLIGHT_AGENT_URI } from './identityHubModel.js'
import type { Step, ProfileUpdates, RestorePurpose } from './identityHubReducer.js'
import {
  createAgentSnapshotExportBundle,
  readAgentSnapshotExportBundle,
  writeAgentSnapshotExportBundle,
} from './snapshotBundle.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>

export type EffectCallbacks = {
  onStep: (step: Step) => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onIdentityComplete: (identity: EthagentIdentity, message: string) => Promise<void>
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
  const jwt = isPinataUploadUrl(apiUrl) ? await resolvePinataJwt() : undefined
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
  const wallet = await requestBrowserWalletSignature({
    chainId: step.registry.chainId,
    messageForAccount: account => createAgentStateRecoveryChallenge(account),
    onReady: callbacks.onWalletReady,
  })
  callbacks.onStep({
    kind: 'create-pinning',
    name: step.name,
    description: step.description,
    registry: step.registry,
    wallet,
    apiUrl: DEFAULT_IPFS_API_URL,
    pinataJwt: step.pinataJwt,
  })
}

export async function runCreatePinning(
  step: Extract<Step, { kind: 'create-pinning' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const ownerAddress = step.wallet.account
  await preflightRegisterAgent({
    ...step.registry,
    ownerAddress,
    agentURI: PREFLIGHT_AGENT_URI,
  })
  const state = initialAgentState(step.name, step.description, ownerAddress)
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: step.wallet.signature,
    state,
  })
  const statePin = await addToIpfs(step.apiUrl, serializeAgentStateBackupEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(statePin)
  const cid = statePin.cid
  const backup: BackupMetadata = {
    cid,
    createdAt: envelope.createdAt,
    envelopeVersion: envelope.envelopeVersion,
    ipfsApiUrl: step.apiUrl,
    status: 'pinned',
    ownerAddress,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
  }
  const registration = withEthagentBackupPointer({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: step.name,
    ...(step.description ? { description: step.description } : {}),
  }, {
    cid,
    envelopeVersion: envelope.envelopeVersion,
    createdAt: envelope.createdAt,
  })
  const metadataPin = await addToIpfs(step.apiUrl, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  const metadataCid = metadataPin.cid
  const agentUri = `ipfs://${metadataCid}`
  callbacks.onStep({
    kind: 'create-registering',
    name: step.name,
    description: step.description,
    registry: step.registry,
    ownerAddress,
    agentUri,
    metadataCid,
    metadataPin,
    backup: { ...backup, metadataCid, agentUri },
    state,
  })
}

export async function runCreateRegistering(
  step: Extract<Step, { kind: 'create-registering' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  await preflightRegisterAgent({
    ...step.registry,
    ownerAddress: step.ownerAddress,
    agentURI: step.agentUri,
  })
  assertVerifiedPin(step.metadataPin, step.metadataCid)
  const tx = await sendBrowserWalletTransaction({
    chainId: step.registry.chainId,
    expectedAccount: step.ownerAddress,
    to: step.registry.identityRegistryAddress,
    data: encodeRegisterAgent({ agentURI: step.agentUri }),
    onReady: callbacks.onWalletReady,
  })
  const client = createErc8004PublicClient(step.registry)
  const receipt = await client.waitForTransactionReceipt({ hash: tx.txHash })
  const registered = registeredAgentFromReceipt({
    logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics] as Hex[], data: log.data })),
    identityRegistryAddress: step.registry.identityRegistryAddress,
    ownerAddress: step.ownerAddress,
  })
  const backup: BackupMetadata = {
    ...step.backup,
    agentId: registered.agentId.toString(),
    agentUri: registered.agentURI,
    txHash: tx.txHash,
  }
  const nextIdentity: EthagentIdentity = {
    source: 'erc8004',
    address: step.ownerAddress,
    ownerAddress: step.ownerAddress,
    createdAt: step.backup.createdAt,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: registered.agentId.toString(),
    agentUri: registered.agentURI,
    metadataCid: step.metadataCid,
    state: step.state,
    backup,
  }
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent registered - #${registered.agentId.toString()}`)
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
  const envelope = parseAgentStateBackupEnvelope(raw)
  assertAgentStateSnapshotOwner(envelope, step.candidate.ownerAddress)
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
  const payload = restoreAgentStateBackupEnvelope({
    envelope: step.envelope,
    walletSignature: wallet.signature,
  })
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
    createdAt: payload.createdAt,
    chainId: step.candidate.chainId,
    rpcUrl: step.candidate.rpcUrl,
    identityRegistryAddress: step.candidate.identityRegistryAddress,
    agentId: step.candidate.agentId.toString(),
    agentUri: step.candidate.agentUri,
    metadataCid: step.candidate.metadataCid,
    state: payload.state,
    backup,
  }
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent restored - #${step.candidate.agentId.toString()}`)
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
  const jwt = isPinataUploadUrl(apiUrl) ? await resolvePinataJwt() : undefined
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
  if (!step.wallet) {
    callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: step.registry, pinataJwt })
    return
  }
  callbacks.onStep({
    kind: 'create-pinning',
    name: step.name,
    description: step.description,
    registry: step.registry,
    wallet: step.wallet,
    apiUrl: DEFAULT_IPFS_API_URL,
    pinataJwt,
  })
}

export async function runNetworkSelect(
  network: string,
  config: EthagentConfig | undefined,
  onConfigChange: ((config: EthagentConfig) => void) | undefined,
): Promise<void> {
  if (!config || !onConfigChange) return
  const next: EthagentConfig = { ...config, selectedNetwork: network as EthagentConfig['selectedNetwork'] }
  await saveConfig(next)
  onConfigChange(next)
}

export async function runRebackupPreflight(
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  callbacks: EffectCallbacks,
  profileUpdates?: ProfileUpdates,
): Promise<void> {
  const apiUrl = DEFAULT_IPFS_API_URL
  const jwt = isPinataUploadUrl(apiUrl) ? await resolvePinataJwt() : undefined
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'rebackup-storage', identity, registry, profileUpdates })
    return
  }
  callbacks.onStep({ kind: 'rebackup-signing', identity, registry, pinataJwt: jwt, profileUpdates })
}

export async function runRebackupSigning(
  step: Extract<Step, { kind: 'rebackup-signing' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const expectedOwner = step.identity.ownerAddress ?? step.identity.address
  const wallet = await requestBrowserWalletSignature({
    chainId: step.registry.chainId,
    messageForAccount: account => createAgentStateRecoveryChallenge(account),
    onReady: callbacks.onWalletReady,
    ...(expectedOwner ? { expectedAccount: getAddress(expectedOwner) } : {}),
  })
  if (expectedOwner && wallet.account.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error(`connect the wallet that owns this agent (${expectedOwner}) and try again`)
  }
  callbacks.onStep({
    kind: 'rebackup-pinning',
    identity: step.identity,
    registry: step.registry,
    wallet,
    apiUrl: DEFAULT_IPFS_API_URL,
    pinataJwt: step.pinataJwt,
    profileUpdates: step.profileUpdates,
  })
}

export async function runRebackupPinning(
  step: Extract<Step, { kind: 'rebackup-pinning' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const ownerAddress = step.wallet.account
  const baseState = (step.identity.state ?? {}) as Record<string, unknown>
  const profile = step.profileUpdates ?? {}
  const nextName = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : (typeof baseState.name === 'string' ? baseState.name : undefined)
  const nextDescription = profile.description !== undefined ? profile.description.trim() : (typeof baseState.description === 'string' ? baseState.description : '')
  const state: Record<string, unknown> = {
    ...baseState,
    ...(nextName !== undefined ? { name: nextName } : {}),
    description: nextDescription,
    lastBackedUpAt: new Date().toISOString(),
  }
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: step.wallet.signature,
    state,
  })
  const statePin = await addToIpfs(step.apiUrl, serializeAgentStateBackupEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(statePin)
  const cid = statePin.cid
  const backup: BackupMetadata = {
    cid,
    createdAt: envelope.createdAt,
    envelopeVersion: envelope.envelopeVersion,
    ipfsApiUrl: step.apiUrl,
    status: 'pinned',
    ownerAddress,
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentId: step.identity.agentId,
  }
  const registration = withEthagentBackupPointer({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: nextName ?? deriveAgentName(step.identity),
    ...(nextDescription ? { description: nextDescription } : {}),
  }, {
    cid,
    envelopeVersion: envelope.envelopeVersion,
    createdAt: envelope.createdAt,
  })
  const metadataPin = await addToIpfs(step.apiUrl, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  const metadataCid = metadataPin.cid
  const agentUri = `ipfs://${metadataCid}`
  callbacks.onStep({
    kind: 'rebackup-uri',
    identity: { ...step.identity, state },
    registry: step.registry,
    agentUri,
    metadataCid,
    metadataPin,
    backup: { ...backup, metadataCid, agentUri },
    ownerAddress,
    profileUpdates: step.profileUpdates,
  })
}

export async function runRebackupUri(
  step: Extract<Step, { kind: 'rebackup-uri' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  if (!step.identity.agentId) throw new Error('cannot back up: identity is missing an agent token id')
  assertVerifiedPin(step.metadataPin, step.metadataCid)
  const agentId = BigInt(step.identity.agentId)
  await preflightSetAgentUri({
    ...step.registry,
    account: step.ownerAddress,
    agentId,
    newUri: step.agentUri,
  })
  const tx = await sendBrowserWalletTransaction({
    chainId: step.registry.chainId,
    expectedAccount: step.ownerAddress,
    to: step.registry.identityRegistryAddress,
    data: encodeSetAgentUri({ agentId, newUri: step.agentUri }),
    onReady: callbacks.onWalletReady,
  })
  const client = createErc8004PublicClient(step.registry)
  await client.waitForTransactionReceipt({ hash: tx.txHash })
  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    source: 'erc8004',
    address: getAddress(step.ownerAddress),
    ownerAddress: getAddress(step.ownerAddress),
    chainId: step.registry.chainId,
    rpcUrl: step.registry.rpcUrl,
    identityRegistryAddress: step.registry.identityRegistryAddress,
    agentUri: step.agentUri,
    metadataCid: step.metadataCid,
    backup: { ...step.backup, txHash: tx.txHash },
  }
  const completionMessage = step.profileUpdates ? 'profile updated and snapshot saved' : 'agent state re-pinned'
  await callbacks.onIdentityComplete(nextIdentity, completionMessage)
}

export async function runRebackupStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'rebackup-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  if (!step.wallet) {
    callbacks.onStep({ kind: 'rebackup-signing', identity: step.identity, registry: step.registry, pinataJwt, profileUpdates: step.profileUpdates })
    return
  }
  callbacks.onStep({
    kind: 'rebackup-pinning',
    identity: step.identity,
    registry: step.registry,
    wallet: step.wallet,
    apiUrl: DEFAULT_IPFS_API_URL,
    pinataJwt,
    profileUpdates: step.profileUpdates,
  })
}

export async function runSnapshotExport(
  identity: EthagentIdentity,
  callbacks: Pick<EffectCallbacks, 'onWalletReady'>,
): Promise<string> {
  const backup = identity.backup
  if (!backup?.cid) throw new Error('no encrypted snapshot to export')
  const raw = await catFromIpfs(backup.ipfsApiUrl, backup.cid)
  const envelope = parseAgentStateBackupEnvelope(raw)
  const owner = getAddress(identity.ownerAddress ?? identity.address)
  assertAgentStateSnapshotOwner(envelope, owner)
  await requestBrowserWalletSignature({
    chainId: identity.chainId ?? backup.chainId ?? 1,
    expectedAccount: owner,
    message: envelope.challenge,
    onReady: callbacks.onWalletReady,
  })
  const bundle = createAgentSnapshotExportBundle({ identity, envelope })
  return await writeAgentSnapshotExportBundle(bundle)
}

export async function runSnapshotImport(
  source: string,
  callbacks: EffectCallbacks,
  cwd?: string,
): Promise<void> {
  const bundle = await readAgentSnapshotExportBundle(source, cwd)
  const ownerAddress = getAddress(bundle.ownerAddress)
  const wallet = await requestBrowserWalletSignature({
    chainId: bundle.chainId ?? 1,
    expectedAccount: ownerAddress,
    message: bundle.envelope.challenge,
    onReady: callbacks.onWalletReady,
  })
  const payload = restoreAgentStateBackupEnvelope({
    envelope: bundle.envelope,
    walletSignature: wallet.signature,
  })
  if (!bundle.agentId || !bundle.agentUri || !bundle.chainId || !bundle.rpcUrl || !bundle.identityRegistryAddress) {
    throw new Error('encrypted snapshot export is missing ERC-8004 identity metadata')
  }
  const identityRegistryAddress = getAddress(bundle.identityRegistryAddress)
  const backup: BackupMetadata = {
    cid: bundle.stateCid,
    createdAt: bundle.envelope.createdAt,
    envelopeVersion: bundle.envelope.envelopeVersion,
    ipfsApiUrl: bundle.ipfsApiUrl,
    status: 'restored',
    ownerAddress,
    chainId: bundle.chainId,
    rpcUrl: bundle.rpcUrl,
    identityRegistryAddress,
    agentId: bundle.agentId,
    agentUri: bundle.agentUri,
    ...(bundle.metadataCid ? { metadataCid: bundle.metadataCid } : {}),
  }
  const nextIdentity: EthagentIdentity = {
    source: 'erc8004',
    address: ownerAddress,
    ownerAddress,
    createdAt: payload.createdAt,
    chainId: bundle.chainId,
    rpcUrl: bundle.rpcUrl,
    identityRegistryAddress,
    agentId: bundle.agentId,
    agentUri: bundle.agentUri,
    ...(bundle.metadataCid ? { metadataCid: bundle.metadataCid } : {}),
    state: payload.state,
    backup,
  }
  await callbacks.onIdentityComplete(nextIdentity, `encrypted snapshot imported - #${bundle.agentId}`)
}

function deriveAgentName(identity: EthagentIdentity): string {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const name = typeof state.name === 'string' ? state.name.trim() : ''
  if (name) return name
  return identity.agentId ? `agent #${identity.agentId}` : 'unnamed agent'
}

function deriveAgentDescription(identity: EthagentIdentity): string {
  const state = (identity.state ?? {}) as Record<string, unknown>
  return typeof state.description === 'string' ? state.description.trim() : ''
}

function assertVerifiedPin(pin: IpfsAddResult, expectedCid?: string): void {
  if (expectedCid && pin.cid !== expectedCid) throw new Error('IPFS pin verification did not match the published CID')
  if (!pin.pinVerified) throw new Error(`IPFS pin was not verified for ${pin.cid}`)
}
