import { getAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  createWalletRestoreAccessChallenge,
  serializeContinuitySnapshotEnvelope,
  type WalletChallengePurpose,
} from '../../continuity/envelope.js'
import {
  prepareSyncedSkillsTree,
  readContinuityFiles,
} from '../../continuity/storage.js'
import {
  syncAgentCardManifest,
} from '../../continuity/skills/publicSkillsSync.js'
import { addToIpfs, DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import {
  createErc8004PublicClient,
  withEthagentPointers,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'
import { VAULT_ABI } from '../../registry/vault.js'
import type { BrowserWalletSignature } from '../../wallet/browserWallet.js'
import type { Step } from '../reducer.js'
import {
  assertVerifiedPin,
  deriveAgentName,
  prepareProfileStateForSave,
} from '../shared/effects/profilePrep.js'
import {
  createContinuityEnvelopeForSave,
  operatorsPointerFromState,
  walletRestoreAccessContext,
} from '../continuity/snapshot.js'

type BackupMetadata = NonNullable<EthagentIdentity['backup']>
type AgentCardMetadata = NonNullable<EthagentIdentity['agentCard']>
type WalletAccessContext = NonNullable<ReturnType<typeof walletRestoreAccessContext>>

export type OperatorProfileArtifacts = {
  nextIdentity: EthagentIdentity
  agentCardJson: string
  agentUri: string
  metadataCid: string
}

export async function prepareOperatorProfileArtifacts(args: {
  step: Extract<Step, { kind: 'public-profile-signing' }>
  wallet: BrowserWalletSignature
  snapshotOwner: Address
  walletAccess: WalletAccessContext
  challengePurpose: WalletChallengePurpose
}): Promise<OperatorProfileArtifacts> {
  const { step, wallet, snapshotOwner, walletAccess, challengePurpose } = args
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

  const agentCardJson = await syncAgentCardManifest(nextIdentityForFiles)
  const agentCardPin = await addToIpfs(DEFAULT_IPFS_API_URL, agentCardJson, fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(agentCardPin)

  const continuityFiles = await readContinuityFiles(nextIdentityForFiles)
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
    challengePurpose,
  })
  const statePin = await addToIpfs(DEFAULT_IPFS_API_URL, serializeContinuitySnapshotEnvelope(envelope), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(statePin)

  const agentCard: AgentCardMetadata = {
    cid: agentCardPin.cid,
    updatedAt: envelope.createdAt,
    status: 'pinned',
  }
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
    agentId: step.identity.agentId!,
  }

  const registration = withEthagentPointers({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: nextName ?? deriveAgentName(step.identity),
    ...(nextDescription ? { description: nextDescription } : {}),
    ...(uploadedImageUri ? { image: uploadedImageUri } : {}),
  }, {
    backup: { cid: statePin.cid, envelopeVersion: envelope.envelopeVersion, createdAt: envelope.createdAt },
    publicDiscovery: { agentCardCid: agentCard.cid, updatedAt: agentCard.updatedAt },
    registration: { chainId: step.registry.chainId, identityRegistryAddress: step.registry.identityRegistryAddress, agentId: step.identity.agentId },
    ensName: nextEnsName,
    operators: operatorsPointerFromState(state, nextEnsName),
    ownerAddress: snapshotOwner,
  })
  const metadataPin = await addToIpfs(DEFAULT_IPFS_API_URL, JSON.stringify(registration, null, 2), fetch, { pinataJwt: step.pinataJwt })
  assertVerifiedPin(metadataPin)
  const metadataCid = metadataPin.cid
  const agentUri = `ipfs://${metadataCid}`

  const nextIdentity: EthagentIdentity = {
    ...step.identity,
    state,
    backup: { ...backup, metadataCid, agentUri },
    agentCard,
    agentUri,
    metadataCid,
  }

  return {
    nextIdentity,
    agentCardJson,
    agentUri,
    metadataCid,
  }
}

export async function assertVaultSignerCanRotateAgentUri(args: {
  registry: Erc8004RegistryConfig
  vaultAddress: Address
  agentId: bigint
  signer: Address
}): Promise<void> {
  const client = createErc8004PublicClient(args.registry)
  const registryAddress = getAddress(args.registry.identityRegistryAddress)
  const vaultAddress = getAddress(args.vaultAddress)
  const signer = getAddress(args.signer)
  let vaultOwner: Address
  try {
    vaultOwner = getAddress(await client.readContract({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: 'agentOwner',
      args: [registryAddress, args.agentId],
    }) as Address)
  } catch (err: unknown) {
    throw new Error(`Could not verify Vault custody for agent #${args.agentId.toString()}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (vaultOwner === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Vault ${vaultAddress} does not currently hold agent token #${args.agentId.toString()}. Connect the owner wallet and run "Fix Records" or return the token to the vault before retrying.`)
  }
  if (vaultOwner.toLowerCase() === signer.toLowerCase()) return

  const isOperator = await client.readContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: 'metadataOperators',
    args: [registryAddress, args.agentId, signer],
  }) as boolean
  if (isOperator) return

  throw new Error(
    `Operator wallet ${signer} is not yet authorized on the Vault to rotate this agent's URI. Connect the owner wallet and run "Fix Records" or re-add this operator to grant the permission.`,
  )
}
