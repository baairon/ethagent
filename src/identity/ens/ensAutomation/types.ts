import type { Address, Hex, PublicClient } from 'viem'
import type {
  AgentEnsRecordState,
  AgentEnsRecords,
  AgentRecordDiff,
} from '../agentRecords.js'
import {
  validateErc8004TokenOwner,
  type Erc8004RegistryConfig,
} from '../../registry/erc8004.js'

export type EnsAutomationReadClient = Pick<PublicClient, 'readContract'>
export type TokenOwnerReadClient = Parameters<typeof validateErc8004TokenOwner>[0]['publicClient']

export type EnsRegistryAction = 'create-subdomain' | 'set-resolver' | 'create-wrapped-subdomain' | 'set-wrapped-resolver' | 'none'

export type EnsSetupPlan = {
  mode: 'simple' | 'advanced'
  rootName: string
  label: string
  fullName: string
  ownerAddress: Address
  operatorAddress: Address
  resolverAddress: Address
  registryAction: EnsRegistryAction
  addressRecord: {
    current: Address | null
    next: Address
    changed: boolean
  }
  currentRecords: AgentEnsRecordState
  nextRecords: AgentEnsRecords
  recordDiffs: AgentRecordDiff[]
  txCount: number
  warnings: string[]
}

export type EnsSetupBlockedPlan = {
  mode: 'simple' | 'advanced'
  rootName: string
  label: string
  fullName: string
  operatorAddress: Address
  ownerAddress?: Address
  resolverAddress?: Address
  reason:
    | 'invalid-root'
    | 'invalid-label'
    | 'missing-token-id'
    | 'root-not-owned'
    | 'root-owner-mismatch'
    | 'wrapped-parent'
    | 'parent-missing-resolver'
    | 'subdomain-owned-by-other'
    | 'subdomain-wrapped'
    | 'operator-matches-owner'
    | 'token-owner-mismatch'
    | 'token-owner-lookup-failed'
    | 'lookup-failed'
  detail: string
  currentRecords?: AgentEnsRecordState
  nextRecords?: AgentEnsRecords
}

export type EnsSetupPreflight =
  | { ok: true; setup: EnsSetupPlan }
  | { ok: false; fallback: EnsSetupBlockedPlan }

export type EncodedEnsTransaction = {
  to: Address
  data: Hex
  calls: Hex[]
}

export type EnsSetupPreflightArgs = {
  rootName: string
  label: string
  operatorAddress: Address
  mode?: 'simple' | 'advanced'
  expectedOwnerAddress?: Address
  allowSameOwnerOperator?: boolean
  registry: Erc8004RegistryConfig
  agentId: string | bigint | undefined
  ensClient?: EnsAutomationReadClient
  tokenPublicClient?: TokenOwnerReadClient
}

export type EnsRootPreflightArgs = {
  rootName: string
  expectedOwnerAddress: Address
  registry: Erc8004RegistryConfig
  agentId: string | bigint | undefined
  ensClient?: EnsAutomationReadClient
  tokenPublicClient?: TokenOwnerReadClient
}

export type EnsRootPreflightResult =
  | { ok: true; ownerAddress: Address }
  | { ok: false; reason: 'invalid-root' | 'missing-token-id' | 'root-not-owned' | 'wrapped-parent' | 'root-owner-mismatch' | 'token-owner-mismatch' | 'token-owner-lookup-failed' | 'lookup-failed'; detail: string }

export type EnsSubdomainDeletePlan = {
  fullName: string
  parentName: string
  label: string
  parentWrapped: boolean
  parentOwnerAddress: Address
  transaction: EncodedEnsTransaction
}

export type EnsSubdomainDeletePreflightArgs = {
  fullName: string
  expectedOwnerAddress: Address
  ensClient?: EnsAutomationReadClient
}

export type EnsSubdomainDeletePreflightResult =
  | { ok: true; plan: EnsSubdomainDeletePlan }
  | { ok: false; reason: 'invalid-name' | 'not-a-subdomain' | 'lookup-failed' | 'parent-not-owned' | 'parent-owner-mismatch' | 'subdomain-missing'; detail: string }

export type OperatorSetDiff = {
  inSync: boolean
  metadataOnly: Address[]
  resolverOnly: Address[]
}
