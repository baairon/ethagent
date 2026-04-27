import type { Address, Hex } from 'viem'
import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../storage/config.js'
import { saveConfig } from '../storage/config.js'
import {
  assertAgentStateBackupOwner,
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
  requestBrowserWalletSignatureAndTransaction,
  type BrowserWalletReady,
} from './browserWallet.js'
import { initialAgentState, PREFLIGHT_AGENT_URI } from './identityHubModel.js'
import type { Step, ProfileUpdates, RestorePurpose } from './identityHubReducer.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>

type CreatePreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  backup: BackupMetadata
  state: Record<string, unknown>
}

type RebackupPreparedTransaction = {
  ownerAddress: Address
  agentUri: string
  metadataCid: string
  backup: BackupMetadata
  identity: EthagentIdentity
}

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
  const result = await requestBrowserWalletSignatureAndTransaction<CreatePreparedTransaction>({
    chainId: step.registry.chainId,
    messageForAccount: account => createAgentStateRecoveryChallenge(account),
    onReady: callbacks.onWalletReady,
    prepareTransaction: async wallet => {
      await preflightRegisterAgent({
        ...step.registry,
        ownerAddress: wallet.account,
        agentURI: PREFLIGHT_AGENT_URI,
      })
      const state = initialAgentState(step.name, step.description, wallet.account)
      const envelope = createAgentStateBackupEnvelope({
        ownerAddress: wallet.account,
        walletSignature: wallet.signature,
        state,
      })
      const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeAgentStateBackupEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
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
      const registration = withEthagentBackupPointer({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: step.name,
        ...(step.description ? { description: step.description } : {}),
      }, {
        cid,
        envelopeVersion: envelope.envelopeVersion,
        createdAt: envelope.createdAt,
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
          state,
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
  }
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
  const envelope = parseAgentStateBackupEnvelope(raw)
  assertAgentStateBackupOwner(envelope, step.candidate.ownerAddress)
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
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: step.registry, pinataJwt })
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
  const result = await requestBrowserWalletSignatureAndTransaction<RebackupPreparedTransaction>({
    chainId: step.registry.chainId,
    messageForAccount: account => createAgentStateRecoveryChallenge(account),
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
      const state: Record<string, unknown> = {
        ...baseState,
        ...(nextName !== undefined ? { name: nextName } : {}),
        description: nextDescription,
        lastBackedUpAt: new Date().toISOString(),
      }
      const envelope = createAgentStateBackupEnvelope({
        ownerAddress: wallet.account,
        walletSignature: wallet.signature,
        state,
      })
      const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeAgentStateBackupEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
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
      const registration = withEthagentBackupPointer({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: nextName ?? deriveAgentName(step.identity),
        ...(nextDescription ? { description: nextDescription } : {}),
      }, {
        cid,
        envelopeVersion: envelope.envelopeVersion,
        createdAt: envelope.createdAt,
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
          identity: { ...step.identity, state },
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
  }
  const completionMessage = step.profileUpdates ? 'profile updated and backup saved' : 'agent backup saved'
  await callbacks.onIdentityComplete(nextIdentity, completionMessage)
}

export async function runRebackupStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'rebackup-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'rebackup-signing', identity: step.identity, registry: step.registry, pinataJwt, profileUpdates: step.profileUpdates })
}

function deriveAgentName(identity: EthagentIdentity): string {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const name = typeof state.name === 'string' ? state.name.trim() : ''
  if (name) return name
  return identity.agentId ? `agent #${identity.agentId}` : 'unnamed agent'
}

function assertVerifiedPin(pin: IpfsAddResult, expectedCid?: string): void {
  if (expectedCid && pin.cid !== expectedCid) throw new Error('IPFS pin verification did not match the published CID')
  if (!pin.pinVerified) throw new Error(`IPFS pin was not verified for ${pin.cid}`)
}
