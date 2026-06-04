import type { EthagentIdentity, SelectableNetwork } from '../../storage/config.js'
import type { Erc8004AgentCandidate, Erc8004RegistryConfig } from '../registry/erc8004.js'
import { networkForChainId } from '../registry/erc8004.js'
import type { RegistryResolution } from '../registry/registryConfig.js'
import type { AgentStateBackupEnvelope } from '../crypto/backupEnvelope.js'
import type { ContinuitySnapshotEnvelope } from '../continuity/envelope.js'
import type { AgentEnsRecordState, AgentEnsRecords } from '../ens/agentRecords.js'
import type { EnsSetupPlan } from '../ens/ensAutomation.js'
import type { WalletPurpose } from '../wallet/browserWallet.js'
import type { IdentityManagerErrorView } from './shared/model/errors.js'
import type { ApprovedOperatorWalletInput } from './shared/operatorWallets.js'
import type { CustodyMode } from './custody/state.js'
import type { ImportCandidate } from './create/importScan.js'

export type RestorePurpose = 'restore' | 'switch'
type RestoreNotFoundReason = 'no-owner-or-operator' | 'search-incomplete' | 'cancelled'
export type ProfileUpdates = {
  name?: string
  description?: string
  imagePath?: string
  ensName?: string
  custodyMode?: 'simple' | 'advanced'
  ownerAddress?: string
  approvedOperatorWallets?: ApprovedOperatorWalletInput[]
  activeOperatorAddress?: string
  operatorVaultAddress?: string
  restoreAccessEpoch?: number
  bumpRestoreAccessEpoch?: boolean
  custodyPhase?: 'switch-advanced' | 'switch-simple'
}

type RestorableBackupEnvelope = AgentStateBackupEnvelope | ContinuitySnapshotEnvelope
type RestoreFetchingStep = { kind: 'restore-fetching'; cid: string; apiUrl: string; candidate: Erc8004AgentCandidate; requesterAddress?: string; purpose?: RestorePurpose }

export type Step =
  | { kind: 'menu' }
  | { kind: 'operation-complete'; message: string }
  | { kind: 'replace-confirm'; next: 'create' | 'restore' }
  | { kind: 'create-name'; name?: string; error?: string }
  | { kind: 'create-description'; name: string; description?: string }
  | { kind: 'create-network'; name: string; description: string }
  | { kind: 'create-custody'; name: string; description: string; network?: SelectableNetwork }
  | { kind: 'create-import'; name: string; description: string; network?: SelectableNetwork; custodyMode: CustodyMode; candidates?: ImportCandidate[] }
  | { kind: 'create-preflight'; name: string; description: string; network?: SelectableNetwork; custodyMode: CustodyMode; importNotes?: ImportCandidate[] }
  | { kind: 'create-registry'; name: string; description: string; resolution: RegistryResolution; custodyMode: CustodyMode; error?: string; importNotes?: ImportCandidate[] }
  | { kind: 'create-signing'; name: string; description: string; registry: Erc8004RegistryConfig; custodyMode: CustodyMode; pinataJwt?: string; importNotes?: ImportCandidate[] }
  | { kind: 'create-storage'; name: string; description: string; registry: Erc8004RegistryConfig; custodyMode: CustodyMode; error?: string; pinataJwt?: string; importNotes?: ImportCandidate[] }
  | { kind: 'first-run-ens-prompt'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; origin?: 'create' | 'restore' }
  | { kind: 'restore-wallet'; purpose?: RestorePurpose }
  | { kind: 'restore-network'; ownerHandle: string; purpose?: RestorePurpose }
  | { kind: 'restore-registry'; ownerHandle: string; error?: string; purpose?: RestorePurpose }
  | { kind: 'restore-discovering'; ownerHandle: string; registry: Erc8004RegistryConfig; purpose?: RestorePurpose; abortSignal?: AbortSignal }
  | { kind: 'restore-recovery-input'; ownerHandle: string; registry: Erc8004RegistryConfig; purpose?: RestorePurpose }
  | { kind: 'restore-ens-input'; ownerHandle: string; registry: Erc8004RegistryConfig; purpose?: RestorePurpose; busy?: boolean; error?: string }
  | { kind: 'restore-token-id-input'; ownerHandle: string; registry: Erc8004RegistryConfig; purpose?: RestorePurpose; busy?: boolean; error?: string }
  | { kind: 'restore-not-found'; ownerHandle: string; registry: Erc8004RegistryConfig; requesterAddress?: string; reason: RestoreNotFoundReason; purpose?: RestorePurpose }
  | { kind: 'restore-select-token'; ownerHandle: string; registry: Erc8004RegistryConfig; candidates: Erc8004AgentCandidate[]; requesterAddress?: string; purpose?: RestorePurpose }
  | RestoreFetchingStep
  | { kind: 'restore-authorizing'; cid: string; apiUrl: string; envelope: RestorableBackupEnvelope; candidate: Erc8004AgentCandidate; requesterAddress?: string; purpose?: RestorePurpose }
  | { kind: 'rebackup-signing'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; pinataJwt?: string; profileUpdates?: ProfileUpdates; returnTo?: Step; walletPurpose?: WalletPurpose; vaultAddress?: `0x${string}` }
  | { kind: 'rebackup-storage'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; error?: string; pinataJwt?: string; profileUpdates?: ProfileUpdates; returnTo?: Step; walletPurpose?: WalletPurpose; vaultAddress?: `0x${string}` }
  | { kind: 'public-profile-signing'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; pinataJwt?: string; profileUpdates?: ProfileUpdates; returnTo?: Step; vaultAddress?: `0x${string}` }
  | { kind: 'public-profile-storage'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; error?: string; pinataJwt?: string; profileUpdates?: ProfileUpdates; returnTo?: Step; vaultAddress?: `0x${string}` }
  | { kind: 'continuity-private'; notice?: string; editorOpened?: boolean }
  | { kind: 'continuity-public'; notice?: string; editorOpened?: boolean }
  | { kind: 'continuity-skills-tree'; notice?: string; editorOpened?: boolean }
  | { kind: 'continuity-skill-actions'; relativePath: string; notice?: string }
  | { kind: 'continuity-skill-delete-confirm'; target: { kind: 'skill'; relativePath: string } }
  | { kind: 'rebackup-confirm'; back: Step }
  | { kind: 'recovery-refetch-confirm'; back: Step }
  | { kind: 'recovery-refetching'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; back: Step }
  | { kind: 'continuity-overwrite-confirm'; action: 'restore'; next: RestoreFetchingStep; back: Step }
  | { kind: 'rebackup-start'; back: Step }
  | { kind: 'edit-profile-menu'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name?: string; description?: string; imagePath?: string; returnTo?: Step }
  | { kind: 'edit-profile-name'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name?: string; description?: string; imagePath?: string; returnTo?: Step }
  | { kind: 'edit-profile-description'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name?: string; description?: string; imagePath?: string; returnTo?: Step }
  | { kind: 'edit-profile-image'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name?: string; description?: string; imagePath?: string; error?: string; returnTo?: Step }
  | { kind: 'edit-profile-review'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name: string; description: string; imagePath?: string; returnTo?: Step }
  | { kind: 'edit-profile-ens'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step; initialView?: 'advanced' }
  | { kind: 'ens-records-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; fullName: string; records: AgentEnsRecords; currentRecords?: AgentEnsRecordState; ownerAddress?: string; returnTo?: Step; clearRecords?: boolean }
  | { kind: 'ens-setup-registry-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; setup: EnsSetupPlan; returnTo?: Step }
  | { kind: 'ens-setup-records-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; setup: EnsSetupPlan; returnTo?: Step; registryTxHash?: string }
  | { kind: 'manage-ens-operators'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step; notice?: string; error?: string }
  | { kind: 'custody-model'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step; notice?: string }
  | { kind: 'custody-advanced-confirm'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step }
  | { kind: 'custody-simple-confirm'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step }
  | { kind: 'custody-vault-deploy-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; profileUpdates: ProfileUpdates; returnTo?: Step }
  | { kind: 'custody-vault-deposit-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; profileUpdates: ProfileUpdates; returnTo?: Step }
  | { kind: 'custody-vault-unwrap-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; profileUpdates: ProfileUpdates; returnTo?: Step; agentIds?: string[] }
  | { kind: 'custody-vault-withdraw-discovering'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; returnTo?: Step; returnContext?: 'ens' | 'simple-exit' }
  | { kind: 'custody-vault-withdraw-pick-token'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; tokens: ReadonlyArray<{ agentId: string }>; returnTo?: Step; returnContext?: 'ens' | 'simple-exit' }
  | { kind: 'custody-vault-withdraw-tx'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; agentId?: string; returnTo?: Step; returnContext?: 'ens' | 'simple-exit' }
  | { kind: 'custody-vault-withdraw-done'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress: `0x${string}`; recipient: `0x${string}`; returnTo?: Step; returnContext?: 'ens' | 'simple-exit' }
  | { kind: 'custody-advanced-done'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; vaultAddress?: `0x${string}`; returnTo?: Step }
  | { kind: 'custody-simple-done'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; returnTo?: Step }
  | { kind: 'token-transfer-target'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; error?: string; previousTarget?: string; returnTo?: Step }
  | { kind: 'token-transfer-resolving'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; targetHandle: string; returnTo?: Step }
  | { kind: 'token-transfer-storage'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; targetHandle: string; targetAddress: string; error?: string; pinataJwt?: string; returnTo?: Step }
  | { kind: 'token-transfer-signing'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; targetHandle: string; targetAddress: string; pinataJwt?: string; returnTo?: Step }
  | { kind: 'token-transfer-ready'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; targetHandle: string; targetAddress: string; snapshotCid: string; txHash: string; returnTo?: Step }
  | { kind: 'storage-credential' }
  | { kind: 'storage-credential-input'; error?: string }
  | { kind: 'storage-credential-forget-confirm' }
  | { kind: 'details' }
  | { kind: 'save-prompt'; back: Step }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; error: IdentityManagerErrorView; back: Step }
  | { kind: 'identity-unlinked'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; onChainOwner?: string; back: Step }

export type Action =
  | { type: 'setStep'; step: Step }
  | { type: 'back'; from: Step }

export function identityManagerReducer(state: Step, action: Action): Step {
  switch (action.type) {
    case 'setStep':
      return action.step
    case 'back':
      return backStep(action.from)
    default:
      return state
  }
}

function backStep(from: Step): Step {
  switch (from.kind) {
    case 'create-name':
      return { kind: 'menu' }
    case 'create-description':
      return { kind: 'create-name', name: from.name }
    case 'create-network':
      return { kind: 'create-description', name: from.name, description: from.description }
    case 'create-custody':
      return { kind: 'create-network', name: from.name, description: from.description }
    case 'create-import':
      return { kind: 'create-custody', name: from.name, description: from.description, ...(from.network ? { network: from.network } : {}) }
    case 'create-preflight':
      return { kind: 'create-custody', name: from.name, description: from.description, ...(from.network ? { network: from.network } : {}) }
    case 'create-registry':
      return { kind: 'create-custody', name: from.name, description: from.description, ...(from.resolution.network ? { network: from.resolution.network } : {}) }
    case 'create-signing': {
      const sigNetwork = networkForChainId(from.registry.chainId)
      return { kind: 'create-custody', name: from.name, description: from.description, ...(sigNetwork ? { network: sigNetwork } : {}) }
    }
    case 'create-storage': {
      const stoNetwork = networkForChainId(from.registry.chainId)
      return { kind: 'create-custody', name: from.name, description: from.description, ...(stoNetwork ? { network: stoNetwork } : {}) }
    }
    case 'first-run-ens-prompt':
      return { kind: 'menu' }
    case 'restore-wallet':
    case 'restore-network':
      return { kind: 'menu' }
    case 'restore-registry':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-discovering':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-recovery-input':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-ens-input':
      return { kind: 'restore-recovery-input', ownerHandle: from.ownerHandle, registry: from.registry, purpose: from.purpose }
    case 'restore-token-id-input':
      return { kind: 'restore-recovery-input', ownerHandle: from.ownerHandle, registry: from.registry, purpose: from.purpose }
    case 'restore-not-found':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-select-token':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-fetching':
      return { kind: 'restore-network', ownerHandle: from.requesterAddress ?? from.candidate.ownerAddress, purpose: from.purpose }
    case 'restore-authorizing':
      return { kind: 'restore-network', ownerHandle: from.requesterAddress ?? from.candidate.ownerAddress, purpose: from.purpose }
    case 'details':
      return { kind: 'menu' }
    case 'rebackup-signing':
    case 'rebackup-storage':
    case 'rebackup-start':
      return from.kind === 'rebackup-start' ? from.back : from.returnTo ?? { kind: 'menu' }
    case 'public-profile-signing':
    case 'public-profile-storage':
      return from.returnTo ?? { kind: 'continuity-public' }
    case 'continuity-private':
    case 'continuity-public':
      return { kind: 'menu' }
    case 'continuity-skills-tree':
      return { kind: 'menu' }
    case 'continuity-skill-actions':
      return { kind: 'continuity-skills-tree' }
    case 'continuity-skill-delete-confirm':
      return { kind: 'continuity-skill-actions', relativePath: from.target.relativePath }
    case 'rebackup-confirm':
    case 'recovery-refetch-confirm':
    case 'recovery-refetching':
      return { kind: 'menu' }
    case 'continuity-overwrite-confirm':
      return from.back
    case 'edit-profile-menu':
      return from.returnTo ?? { kind: 'continuity-public' }
    case 'edit-profile-name':
      return { kind: 'edit-profile-menu', identity: from.identity, registry: from.registry, name: from.name, description: from.description, imagePath: from.imagePath, returnTo: from.returnTo }
    case 'edit-profile-description':
      return { kind: 'edit-profile-name', identity: from.identity, registry: from.registry, name: from.name, description: from.description, imagePath: from.imagePath, returnTo: from.returnTo }
    case 'edit-profile-image':
      return { kind: 'edit-profile-description', identity: from.identity, registry: from.registry, name: from.name, description: from.description, imagePath: from.imagePath, returnTo: from.returnTo }
    case 'edit-profile-review':
      return { kind: 'edit-profile-image', identity: from.identity, registry: from.registry, name: from.name, description: from.description, imagePath: from.imagePath, returnTo: from.returnTo }
    case 'edit-profile-ens':
      return from.returnTo ?? { kind: 'menu' }
    case 'ens-records-tx':
      return { kind: 'edit-profile-ens', identity: from.identity, registry: from.registry, returnTo: from.returnTo }
    case 'ens-setup-registry-tx':
    case 'ens-setup-records-tx':
      return {
        kind: 'edit-profile-ens',
        identity: from.identity,
        registry: from.registry,
        returnTo: from.returnTo,
        ...(from.setup.mode === 'advanced' ? { initialView: 'advanced' as const } : {}),
      }
    case 'manage-ens-operators':
      return from.returnTo ?? { kind: 'menu' }
    case 'custody-model':
      return from.returnTo ?? { kind: 'menu' }
    case 'custody-advanced-confirm':
    case 'custody-simple-confirm':
    case 'custody-vault-deploy-tx':
    case 'custody-vault-deposit-tx':
    case 'custody-vault-unwrap-tx':
    case 'custody-vault-withdraw-discovering':
    case 'custody-vault-withdraw-pick-token':
    case 'custody-vault-withdraw-tx':
    case 'custody-vault-withdraw-done':
      return { kind: 'custody-model', identity: from.identity, registry: from.registry, returnTo: from.returnTo }
    case 'custody-advanced-done':
    case 'custody-simple-done':
      return from.returnTo ?? { kind: 'menu' }
    case 'token-transfer-target':
      return from.returnTo ?? { kind: 'menu' }
    case 'token-transfer-resolving':
    case 'token-transfer-storage':
    case 'token-transfer-signing':
      return { kind: 'token-transfer-target', identity: from.identity, registry: from.registry, returnTo: from.returnTo }
    case 'token-transfer-ready':
      return from.returnTo ?? { kind: 'menu' }
    case 'storage-credential':
    case 'storage-credential-input':
    case 'storage-credential-forget-confirm':
      return { kind: 'menu' }
    case 'save-prompt':
      return from.back
    case 'error':
      return from.back
    case 'identity-unlinked':
      return from.back
    default:
      return { kind: 'menu' }
  }
}

export const CREATE_STEP_LABELS = ['Name', 'Describe', 'Network', 'Custody', 'Create']

export function createStepNumber(step: Step): number {
  switch (step.kind) {
    case 'create-name':
      return 1
    case 'create-description':
      return 2
    case 'create-network':
      return 3
    case 'create-custody':
      return 4
    case 'create-import':
    case 'create-preflight':
    case 'create-storage':
    case 'create-registry':
    case 'create-signing':
      return 5
    default:
      return 0
  }
}
