import type React from 'react'
import type { Address } from 'viem'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import type { Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import type { EffectCallbacks } from '../../effects/types.js'
import type { ProfileUpdates, Step } from '../../identityHubReducer.js'
import type { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'

export type GuardOwnership = (
  identity: EthagentIdentity,
  registry: Erc8004RegistryConfig,
  role: 'token-holder' | 'vault-level-owner',
  fallback: Step,
) => Promise<boolean>

export type TriggerRebackup = (
  back: Step,
  profileUpdates?: ProfileUpdates,
  options?: { vaultAddress?: `0x${string}`; useVault?: boolean },
) => void

export interface CustodyFlowDeps {
  config: EthagentConfig | undefined
  step: Step
  setStep: (step: Step) => void
  callbacks: EffectCallbacks
  walletSession: React.ComponentProps<typeof WalletApprovalScreen>['walletSession']
  handleStepError: (err: unknown, fallback: Step) => void
  guardOwnership: GuardOwnership
  triggerRebackup: TriggerRebackup
  refreshReconciliation: () => void
  onConfigChange?: (config: EthagentConfig) => void
}

export interface CustodyFlow {
  beginVaultDeposit: (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates) => void
  beginVaultUnwrap: (currentStep: Step, returnTo: Step, profileUpdates: ProfileUpdates) => void
  beginWithdrawToken: (currentStep: Step, returnTo: Step) => void
  beginReturnToVault: (currentStep: Step, returnTo: Step, vaultAddress: Address) => void
  renderCustodyStep: () => React.ReactElement | null
  renderRebackupSubtitle: (
    defaultSubtitle: React.ReactNode,
    vaultRouted: boolean,
  ) => React.ReactNode
}
