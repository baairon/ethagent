import type { Address, Hex } from 'viem'
import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../../../storage/config.js'
import { saveConfig } from '../../../storage/config.js'
import {
  createContinuitySnapshotChallenge,
  createContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
} from '../../continuity/envelope.js'
import {
  continuityAgentSnapshot,
  defaultContinuityFiles,
  writeIdentityMarkdownScaffold,
} from '../../continuity/storage.js'
import {
  createAgentCard,
  defaultPublicSkillsProfile,
  renderPublicSkillsJson,
  serializeAgentCard,
} from '../../continuity/publicSkills.js'
import { recordPublishedContinuitySnapshot } from '../../continuity/snapshots.js'
import { addToIpfs, DEFAULT_IPFS_API_URL, isPinataUploadUrl } from '../../storage/ipfs.js'
import {
  chainIdForNetwork,
  createErc8004PublicClient,
  encodeRegisterAgent,
  erc8004ConfigForSupportedChain,
  normalizeErc8004RegistryConfig,
  preflightRegisterAgent,
  registeredAgentFromReceipt,
  withEthagentPointers,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { registryConfigFromConfig, type RegistryResolution } from '../../registry/registryConfig.js'
import { resolveValidatedPinataJwt, savePinataJwt } from '../../storage/pinataJwt.js'
import { setOwnerAddressField } from '../../identityCompat.js'
import {
  requestBrowserWalletSignatureAndTransaction,
} from '../../wallet/browserWallet.js'
import { initialAgentState, PREFLIGHT_AGENT_URI } from '../model/identity.js'
import type { Step } from '../identityHubReducer.js'
import type { EffectCallbacks } from './types.js'
import { awaitConfirmedReceipt } from './receipts.js'
import { assertVerifiedPin } from './shared/profilePrep.js'

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

export async function runCreatePreflight(
  step: Extract<Step, { kind: 'create-preflight' }>,
  config: EthagentConfig | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const resolution = step.network
    ? registryResolutionForNetwork(step.network)
    : registryConfigFromConfig(config)
  if (!resolution.config) {
    callbacks.onStep({ kind: 'create-registry', name: step.name, description: step.description, resolution, custodyMode: step.custodyMode })
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
      custodyMode: step.custodyMode,
      error: (err as Error).message,
    })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry: resolution.config, custodyMode: step.custodyMode })
    return
  }
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: resolution.config, custodyMode: step.custodyMode, pinataJwt: jwt })
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
    purpose: 'create-agent',
    prepareTransaction: async wallet => {
      await preflightRegisterAgent({
        ...step.registry,
        ownerAddress: wallet.account,
        agentURI: PREFLIGHT_AGENT_URI,
      })
      const state = initialAgentState(step.name, step.description, wallet.account)
      state.custodyMode = step.custodyMode
      if (step.custodyMode === 'advanced') {
        setOwnerAddressField(state, wallet.account)
      }
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
      const registration = withEthagentPointers({
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: step.name,
        ...(step.description ? { description: step.description } : {}),
        ...(typeof state.imageUrl === 'string' ? { image: state.imageUrl } : {}),
      }, {
        backup: { cid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt },
        publicDiscovery: { skillsCid: publicSkills.cid, agentCardCid: publicSkills.agentCardCid, updatedAt: publicSkills.updatedAt },
        registration: { chainId: step.registry.chainId, identityRegistryAddress: step.registry.identityRegistryAddress },
        ownerAddress: wallet.account,
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
  const receipt = await awaitConfirmedReceipt(client, result.txHash, 'Agent registration', { kind: 'register', chainId: step.registry.chainId })
  const registered = registeredAgentFromReceipt({
    logs: receipt.logs.map(log => ({ address: log.address, topics: [...log.topics] as Hex[], data: log.data })),
    identityRegistryAddress: step.registry.identityRegistryAddress,
    ownerAddress: result.prepared.ownerAddress,
    fallbackAgentURI: result.prepared.agentUri,
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
    connectedWallet: result.prepared.ownerAddress,
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
  await callbacks.onIdentityComplete(nextIdentity, `ERC-8004 agent registered · #${registered.agentId.toString()}`, 'create')
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
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry, custodyMode: step.custodyMode, error: (err as Error).message })
    return
  }
  if (isPinataUploadUrl(apiUrl) && !jwt) {
    callbacks.onStep({ kind: 'create-storage', name: step.name, description: step.description, registry, custodyMode: step.custodyMode })
    return
  }
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry, custodyMode: step.custodyMode, pinataJwt: jwt })
}

export async function runStorageSubmit(
  input: string,
  step: Extract<Step, { kind: 'create-storage' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const { jwt: pinataJwt } = await savePinataJwt(input)
  callbacks.onStep({ kind: 'create-signing', name: step.name, description: step.description, registry: step.registry, custodyMode: step.custodyMode, pinataJwt })
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
