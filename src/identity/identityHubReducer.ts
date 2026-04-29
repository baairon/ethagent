import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../storage/config.js'
import type { Erc8004AgentCandidate, Erc8004RegistryConfig } from './erc8004.js'
import type { RegistryResolution } from './registryConfig.js'
import type { AgentStateBackupEnvelope } from './backupEnvelope.js'
import type { IdentityHubErrorView } from './identityHubModel.js'

export type RestorePurpose = 'restore' | 'switch'
export type DetailsView = Extract<Step, { kind: 'details' }>
export type ProfileUpdates = { name?: string; description?: string }

export type Step =
  | { kind: 'menu' }
  | { kind: 'replace-confirm'; next: 'create' | 'restore' }
  | { kind: 'create-name'; error?: string }
  | { kind: 'create-description'; name: string }
  | { kind: 'create-network'; name: string; description: string }
  | { kind: 'create-preflight'; name: string; description: string; network?: SelectableNetwork }
  | { kind: 'create-registry'; name: string; description: string; resolution: RegistryResolution; error?: string }
  | { kind: 'create-signing'; name: string; description: string; registry: Erc8004RegistryConfig; pinataJwt?: string }
  | { kind: 'create-storage'; name: string; description: string; registry: Erc8004RegistryConfig; error?: string; pinataJwt?: string }
  | { kind: 'restore-owner'; purpose?: RestorePurpose }
  | { kind: 'restore-wallet'; purpose?: RestorePurpose }
  | { kind: 'restore-network'; ownerHandle: string; purpose?: RestorePurpose }
  | { kind: 'restore-registry'; ownerHandle: string; error?: string; purpose?: RestorePurpose }
  | { kind: 'restore-discovering'; ownerHandle: string; registry: Erc8004RegistryConfig; purpose?: RestorePurpose }
  | { kind: 'restore-token-id'; ownerHandle: string; registry: Erc8004RegistryConfig; error?: string; purpose?: RestorePurpose }
  | { kind: 'restore-select-token'; ownerHandle: string; registry: Erc8004RegistryConfig; candidates: Erc8004AgentCandidate[]; purpose?: RestorePurpose }
  | { kind: 'restore-fetching'; cid: string; apiUrl: string; candidate: Erc8004AgentCandidate; purpose?: RestorePurpose }
  | { kind: 'restore-authorizing'; cid: string; apiUrl: string; envelope: AgentStateBackupEnvelope; candidate: Erc8004AgentCandidate; purpose?: RestorePurpose }
  | { kind: 'rebackup-signing'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; pinataJwt?: string; profileUpdates?: ProfileUpdates }
  | { kind: 'rebackup-storage'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; error?: string; pinataJwt?: string; profileUpdates?: ProfileUpdates }
  | { kind: 'edit-profile-name'; identity: EthagentIdentity; registry: Erc8004RegistryConfig }
  | { kind: 'edit-profile-description'; identity: EthagentIdentity; registry: Erc8004RegistryConfig; name: string }
  | { kind: 'forget-confirm' }
  | { kind: 'storage-credential' }
  | { kind: 'storage-credential-input'; error?: string }
  | { kind: 'storage-credential-forget-confirm' }
  | { kind: 'details'; copyPicker?: boolean }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; error: IdentityHubErrorView; back: Step }

export type Action =
  | { type: 'goMenu' }
  | { type: 'startCreate'; hasIdentity: boolean }
  | { type: 'confirmReplace' }
  | { type: 'cancelReplace' }
  | { type: 'nameSubmitted'; name: string }
  | { type: 'descriptionSubmitted'; name: string; description: string }
  | { type: 'preflightResolved'; step: Step }
  | { type: 'registrySubmitted'; step: Step }
  | { type: 'storageSubmitted'; step: Step }
  | { type: 'walletSigned'; step: Step }
  | { type: 'pinned'; step: Step }
  | { type: 'registered'; step: Step }
  | { type: 'startRestore' }
  | { type: 'ownerSubmitted'; step: Step }
  | { type: 'restoreRegistrySubmitted'; step: Step }
  | { type: 'discovered'; step: Step }
  | { type: 'tokenSelected'; step: Step }
  | { type: 'fetched'; step: Step }
  | { type: 'authorized' }
  | { type: 'openDetails' }
  | { type: 'startForgetIdentity' }
  | { type: 'cancelForgetIdentity' }
  | { type: 'openCopyPicker' }
  | { type: 'closeCopyPicker' }
  | { type: 'error'; error: IdentityHubErrorView; back: Step }
  | { type: 'back'; from: Step }

export function identityHubReducer(state: Step, action: Action): Step {
  switch (action.type) {
    case 'goMenu':
      return { kind: 'menu' }
    case 'startCreate':
      if (action.hasIdentity) return { kind: 'replace-confirm', next: 'create' }
      return { kind: 'create-name' }
    case 'confirmReplace':
      return { kind: 'create-name' }
    case 'cancelReplace':
      return { kind: 'menu' }
    case 'nameSubmitted':
      return { kind: 'create-description', name: action.name }
    case 'descriptionSubmitted':
      return { kind: 'create-network', name: action.name, description: action.description }
    case 'preflightResolved':
    case 'registrySubmitted':
    case 'storageSubmitted':
    case 'walletSigned':
    case 'pinned':
    case 'registered':
    case 'ownerSubmitted':
    case 'restoreRegistrySubmitted':
    case 'discovered':
    case 'tokenSelected':
    case 'fetched':
      return action.step
    case 'startRestore':
      return { kind: 'restore-wallet' }
    case 'openDetails':
      return { kind: 'details' }
    case 'startForgetIdentity':
      return { kind: 'forget-confirm' }
    case 'cancelForgetIdentity':
      return { kind: 'details' }
    case 'openCopyPicker':
      if (state.kind === 'details') return { kind: 'details', copyPicker: true }
      return state
    case 'closeCopyPicker':
      if (state.kind === 'details') return { kind: 'details' }
      return state
    case 'error':
      return { kind: 'error', error: action.error, back: action.back }
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
      return { kind: 'create-name' }
    case 'create-network':
      return { kind: 'create-description', name: from.name }
    case 'create-preflight':
      return { kind: 'create-network', name: from.name, description: from.description }
    case 'create-registry':
      return { kind: 'create-network', name: from.name, description: from.description }
    case 'create-signing':
      return { kind: 'create-network', name: from.name, description: from.description }
    case 'create-storage':
      return { kind: 'create-network', name: from.name, description: from.description }
    case 'restore-owner':
      return { kind: 'menu' }
    case 'restore-wallet':
      return { kind: 'restore-owner', purpose: from.purpose }
    case 'restore-network':
      return { kind: 'restore-owner', purpose: from.purpose }
    case 'restore-registry':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-discovering':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-token-id':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-select-token':
      return { kind: 'restore-network', ownerHandle: from.ownerHandle, purpose: from.purpose }
    case 'restore-fetching':
      return { kind: 'restore-network', ownerHandle: from.candidate.ownerAddress, purpose: from.purpose }
    case 'restore-authorizing':
      return { kind: 'restore-network', ownerHandle: from.candidate.ownerAddress, purpose: from.purpose }
    case 'details':
      if (from.copyPicker) return { kind: 'details' }
      return { kind: 'menu' }
    case 'rebackup-signing':
    case 'rebackup-storage':
      return { kind: 'details' }
    case 'edit-profile-name':
      return { kind: 'details' }
    case 'edit-profile-description':
      return { kind: 'edit-profile-name', identity: from.identity, registry: from.registry }
    case 'forget-confirm':
    case 'storage-credential':
    case 'storage-credential-input':
    case 'storage-credential-forget-confirm':
      return { kind: 'details' }
    case 'error':
      return from.back
    default:
      return { kind: 'menu' }
  }
}

export const CREATE_STEP_LABELS = ['name', 'describe', 'network', 'create']

export function createStepNumber(step: Step): number {
  switch (step.kind) {
    case 'create-name':
      return 1
    case 'create-description':
      return 2
    case 'create-network':
      return 3
    case 'create-preflight':
    case 'create-storage':
    case 'create-registry':
    case 'create-signing':
      return 4
    default:
      return 0
  }
}
