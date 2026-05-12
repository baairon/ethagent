import type { Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import type {
  AgentEnsRecordState,
  AgentEnsRecords,
  AgentRecordDiff,
} from '../../ens/agentRecords.js'
import type { EnsValidation } from '../../ens/ensLookup.js'
import type {
  EnsRegistryAction,
  EnsSetupBlockedPlan,
  EnsSetupPlan,
  EnsSubdomainDeletePlan,
} from '../../ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import type { AgentReconciliation } from '../shared/reconciliation/index.js'
import type { EnsLinkOptions } from './editCopy.js'

export type EnsIssueValidation = Extract<EnsValidation, { ok: false }>

export type SimpleEnsPhase =
  | { kind: 'discovering'; mode?: 'simple' | 'advanced' }
  | { kind: 'pick-parent'; mode?: 'simple' | 'advanced'; error?: string }
  | { kind: 'manual-parent'; mode?: 'simple' | 'advanced'; error?: string }
  | { kind: 'pick-subdomain'; parent: string; label?: string; error?: string }
  | { kind: 'simple-name-missing'; fullName: string; validation: EnsIssueValidation }
  | { kind: 'simple-create-preflight'; rootName: string; label: string; fullName: string }
  | { kind: 'simple-create-review'; setup: EnsSetupPlan }
  | { kind: 'simple-create-blocked'; fallback: EnsSetupBlockedPlan }
  | { kind: 'validating'; fullName: string; mode: 'simple' | 'advanced'; ownerAddress?: Address; operatorWallet?: Address }
  | { kind: 'review'; fullName: string; validation: EnsValidation; recordsDiff: AgentRecordDiff[]; currentRecords: AgentEnsRecordState; nextRecords: AgentEnsRecords; mode: 'simple' | 'advanced'; ownerAddress?: Address; operatorWallet?: Address }

export type AdvancedEnsPhase =
  | { kind: 'advanced-transfer-check' }
  | { kind: 'advanced-root-check'; rootName: string }
  | { kind: 'advanced-subdomain'; rootName: string; label?: string; error?: string }
  | { kind: 'advanced-subdomain-check'; rootName: string; label: string }
  | { kind: 'advanced-review'; setup: EnsSetupPlan }
  | { kind: 'advanced-manual'; fallback: EnsSetupBlockedPlan }

export type UnlinkEnsPhase =
  | { kind: 'unlink-loading'; fullName: string }
  | { kind: 'unlink-review'; fullName: string; currentRecords: AgentEnsRecordState; recordsDiff: AgentRecordDiff[] }

export type DeleteSubdomainPhase =
  | { kind: 'delete-subdomain-preflight'; fullName: string }
  | { kind: 'delete-subdomain-confirm'; plan: EnsSubdomainDeletePlan }
  | { kind: 'delete-subdomain-blocked'; fullName: string; reason: string }
  | { kind: 'delete-subdomain-tx'; plan: EnsSubdomainDeletePlan }
  | { kind: 'delete-subdomain-done'; fullName: string }

export type EnsPhase =
  | { kind: 'mode-select' }
  | SimpleEnsPhase
  | AdvancedEnsPhase
  | UnlinkEnsPhase
  | DeleteSubdomainPhase

export type DiscoveryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; names: string[]; warning?: string }
  | { status: 'error'; message: string; names: string[] }

export type EnsEditProps = {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  reconciliation: AgentReconciliation
  onEnsLink: (fullName: string, options: EnsLinkOptions) => void
  onEnsUnlink: () => void
  onEnsRecordsUpdate: (fullName: string, records: AgentEnsRecords, options: EnsLinkOptions, clearRecords?: boolean, currentRecords?: AgentEnsRecordState) => void
  onEnsSetup: (setup: EnsSetupPlan) => void
  onManageOperatorWalletAccess: () => void
  onWithdrawToken: () => void
  initialView?: 'advanced'
  onBack: () => void
}
