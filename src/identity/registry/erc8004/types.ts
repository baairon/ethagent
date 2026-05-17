import type { Address, PublicClient } from 'viem'
import type { TransferSnapshotMetadata } from '../../../storage/config.js'
import type { WalletContinuityRestoreAccessKey } from '../../continuity/envelope.js'

export type FetchLike = typeof fetch

export type Erc8004RegistryConfig = {
  chainId: number
  rpcUrl: string
  identityRegistryAddress: Address
  fromBlock?: bigint
}

export type EthagentBackupPointer = {
  cid: string
  envelopeVersion?: string
  createdAt?: string
  agentAddress?: Address
  transferSnapshot?: TransferSnapshotMetadata
  pastBackups?: Array<{ cid: string; createdAt?: string }>
}

export type EthagentPublicDiscoveryPointer = {
  agentCardCid?: string
  updatedAt?: string
}

export type EthagentRegistrationPointer = {
  chainId: number
  identityRegistryAddress: Address
  agentId?: string | number
}

export type ApprovedOperatorWalletRecord = {
  address: Address
  challenge?: string
  verifiedAt?: string
  restoreAccessKey?: WalletContinuityRestoreAccessKey
}

export type EthagentOperatorsPointer = {
  approvedOperatorWallets: ApprovedOperatorWalletRecord[]
  activeOperatorAddress?: Address
  ownerAddress?: Address
  ensName?: string
  restoreAccessEpoch?: number
  ownerRestoreAccessKey?: WalletContinuityRestoreAccessKey
}

export type EthagentX402Pointer = {
  walletAddress: Address
}

export type Erc8004AgentCandidate = {
  tokenOwnerAddress?: Address
  ownerAddress: Address
  chainId: number
  rpcUrl: string
  identityRegistryAddress: Address
  agentId: bigint
  agentUri: string
  metadataCid?: string
  name?: string
  description?: string
  imageUrl?: string
  backup?: EthagentBackupPointer
  publicDiscovery?: EthagentPublicDiscoveryPointer
  operators?: EthagentOperatorsPointer
  registration: Record<string, unknown> | null
}

export type DiscoverOwnedAgentsArgs = Erc8004RegistryConfig & {
  ownerHandle: string
  ipfsApiUrl?: string
  publicClient?: PublicClient
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export type DiscoverOwnedAgentsAcrossSupportedNetworksArgs = {
  ownerHandle: string
  registryOverrides?: Erc8004RegistryConfig[]
  ipfsApiUrl?: string
  publicClients?: Partial<Record<number, PublicClient>>
  fetchImpl?: FetchLike
  signal?: AbortSignal
}
