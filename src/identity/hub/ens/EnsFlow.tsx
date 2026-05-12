import React from 'react'
import { openImageFilePicker } from '../../profile/imagePicker.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { ProfileUpdates, Step } from '../identityHubReducer.js'
import { readCustodyMode } from '../custody/state.js'
import { OperatorWalletsScreen } from './EnsOperatorWalletsScreen.js'
import { EDIT_PROFILE_STEPS, EditProfileFlow } from '../profile/EditProfileFlow.js'
import { FlowTimeline } from '../shared/components/FlowTimeline.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import type { AgentReconciliation } from '../shared/reconciliation/index.js'

type StepOf<K extends Step['kind']> = Extract<Step, { kind: K }>

type IdentityHubEnsStep = StepOf<
  | 'manage-ens-operators'
  | 'edit-profile-name'
  | 'edit-profile-description'
  | 'edit-profile-image'
  | 'edit-profile-review'
  | 'edit-profile-ens'
  | 'ens-records-tx'
  | 'ens-setup-registry-tx'
  | 'ens-setup-records-tx'
  | 'public-profile-signing'
>

type EnsFlowProps = {
  step: IdentityHubEnsStep
  walletSession: BrowserWalletReady | null
  reconciliation: AgentReconciliation
  onSetStep: (step: Step) => void
  onBack: () => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onTriggerRebackup: (backStep: Step, profileUpdates?: ProfileUpdates) => void
  onTriggerPublicProfileSave: (backStep: Step, profileUpdates: ProfileUpdates) => void
  onWithdrawTokenForEns: (step: Step) => void
}

export function isEnsStep(step: Step): step is IdentityHubEnsStep {
  return step.kind === 'manage-ens-operators'
    || step.kind === 'edit-profile-name'
    || step.kind === 'edit-profile-description'
    || step.kind === 'edit-profile-image'
    || step.kind === 'edit-profile-review'
    || step.kind === 'edit-profile-ens'
    || step.kind === 'ens-records-tx'
    || step.kind === 'ens-setup-registry-tx'
    || step.kind === 'ens-setup-records-tx'
    || step.kind === 'public-profile-signing'
}

export const EnsFlow: React.FC<EnsFlowProps> = ({
  step,
  walletSession,
  reconciliation,
  onSetStep,
  onBack,
  onWalletReady,
  onTriggerRebackup,
  onTriggerPublicProfileSave,
  onWithdrawTokenForEns,
}) => {
  if (step.kind === 'manage-ens-operators') {
    return (
      <OperatorWalletsScreen
        identity={step.identity}
        registry={step.registry}
        walletSession={walletSession}
        notice={step.notice}
        error={step.error}
        onSave={updates => onTriggerRebackup(step.returnTo ?? { kind: 'menu' }, updates)}
        onWalletReady={onWalletReady}
        onBack={onBack}
      />
    )
  }

  if (isEditProfileStep(step)) {
    return (
      <EditProfileFlow
        step={step}
        reconciliation={reconciliation}
        onWithdrawToken={() => onWithdrawTokenForEns(step)}
        onNameSubmit={name => {
          if (step.kind !== 'edit-profile-name') return
          onSetStep({
            kind: 'edit-profile-description',
            identity: step.identity,
            registry: step.registry,
            name,
            description: step.description,
            imagePath: step.imagePath,
            returnTo: step.returnTo,
          })
        }}
        onDescriptionSubmit={description => {
          if (step.kind !== 'edit-profile-description') return
          onSetStep({ kind: 'edit-profile-image', identity: step.identity, registry: step.registry, name: step.name, description, imagePath: step.imagePath, returnTo: step.returnTo })
        }}
        onIconSubmit={iconPath => {
          if (step.kind !== 'edit-profile-image') return
          onSetStep({ kind: 'edit-profile-review', identity: step.identity, registry: step.registry, name: step.name, description: step.description, ...(iconPath !== undefined ? { imagePath: iconPath } : {}), returnTo: step.returnTo })
        }}
        onIconPick={() => {
          if (step.kind !== 'edit-profile-image') return
          const iconStep = step
          void openImageFilePicker()
            .then(result => {
              if (!result.ok) {
                onSetStep({ ...iconStep, error: result.cancelled ? 'icon selection cancelled.' : `${result.error}` })
                return
              }
              onSetStep({
                kind: 'edit-profile-review',
                identity: iconStep.identity,
                registry: iconStep.registry,
                name: iconStep.name,
                description: iconStep.description,
                imagePath: result.file,
                returnTo: iconStep.returnTo,
              })
            })
            .catch((err: unknown) => {
              onSetStep({ ...iconStep, error: `${(err as Error).message}` })
            })
        }}
        onReviewSave={() => {
          if (step.kind !== 'edit-profile-review') return
          const updates: ProfileUpdates = {
            name: step.name,
            description: step.description,
            ...(step.imagePath !== undefined ? { imagePath: step.imagePath } : {}),
          }
          onTriggerPublicProfileSave(step.returnTo ?? { kind: 'continuity-public' }, updates)
        }}
        onEnsLink={(fullName, options) => {
          if (step.kind !== 'edit-profile-ens') return
          const state = (step.identity.state ?? {}) as Record<string, unknown>
          const savedOwnerAddress = readOwnerAddressField(state) ?? ''
          const updates: ProfileUpdates = {
            ensName: fullName,
            ...(options.mode === 'advanced' && options.ownerAddress && !savedOwnerAddress ? { ownerAddress: options.ownerAddress } : {}),
            ...(options.mode === 'advanced' && options.operatorWallet ? {
              approvedOperatorWallets: [options.operatorWallet],
              activeOperatorAddress: options.operatorWallet,
            } : {}),
          }
          onTriggerRebackup(step.returnTo ?? { kind: 'menu' }, updates)
        }}
        onEnsUnlink={() => {
          if (step.kind !== 'edit-profile-ens') return
          onTriggerRebackup(step.returnTo ?? { kind: 'menu' }, { ensName: '' })
        }}
        onEnsRecordsUpdate={(fullName, records, options, clearRecords, currentRecords) => {
          if (step.kind !== 'edit-profile-ens') return
          onSetStep({
            kind: 'ens-records-tx',
            identity: step.identity,
            registry: step.registry,
            fullName,
            records,
            ...(currentRecords ? { currentRecords } : {}),
            ...(clearRecords ? { clearRecords: true } : {}),
            ...(options.mode === 'advanced' && options.ownerAddress ? { ownerAddress: options.ownerAddress } : {}),
            returnTo: step.returnTo ?? { kind: 'menu' },
          })
        }}
        onEnsSetup={setup => {
          if (step.kind !== 'edit-profile-ens') return
          if (setup.registryAction === 'none') {
            onSetStep({
              kind: 'ens-setup-records-tx',
              identity: step.identity,
              registry: step.registry,
              setup,
              returnTo: step.returnTo ?? { kind: 'menu' },
            })
            return
          }
          onSetStep({
            kind: 'ens-setup-registry-tx',
            identity: step.identity,
            registry: step.registry,
            setup,
            returnTo: step.returnTo ?? { kind: 'menu' },
          })
        }}
        onManageOperatorWalletAccess={() => {
          if (step.kind !== 'edit-profile-ens') return
          onSetStep({
            kind: 'manage-ens-operators',
            identity: step.identity,
            registry: step.registry,
            returnTo: { kind: 'edit-profile-ens', identity: step.identity, registry: step.registry, returnTo: step.returnTo, initialView: 'advanced' },
          })
        }}
        onBack={onBack}
        onMenu={() => onSetStep(step.returnTo ?? { kind: 'continuity-public' })}
      />
    )
  }

  if (step.kind === 'ens-records-tx') {
    return (
      <WalletApprovalScreen
        title={step.clearRecords ? 'Unlink ENS' : 'Update ENS Records'}
        subtitle={step.clearRecords
          ? `Ethereum Mainnet: sign one transaction to clear ethagent record values on ${step.fullName}. Requires gas.`
          : `Ethereum Mainnet: sign one transaction to set ENS records on ${step.fullName}. Requires gas.`}
        walletSession={walletSession}
        label="waiting for wallet transaction..."
        onCancel={() => onSetStep({ kind: 'edit-profile-ens', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }

  if (step.kind === 'ens-setup-registry-tx') {
    const signer = step.setup.mode === 'simple' ? 'Connected wallet' : 'Owner wallet'
    return (
      <WalletApprovalScreen
        title={step.setup.mode === 'simple' ? 'Use Connected Wallet' : 'Use Owner Wallet'}
        subtitle={`${signer} signs one Ethereum Mainnet ENS registry transaction for ${step.setup.fullName}.`}
        walletSession={walletSession}
        label={step.setup.mode === 'simple' ? 'waiting for connected wallet transaction...' : 'waiting for owner wallet transaction...'}
        onCancel={() => onSetStep({
          kind: 'edit-profile-ens',
          identity: step.identity,
          registry: step.registry,
          returnTo: step.returnTo,
          ...(step.setup.mode === 'advanced' ? { initialView: 'advanced' as const } : {}),
        })}
      />
    )
  }

  if (step.kind === 'ens-setup-records-tx') {
    const signer = step.setup.mode === 'simple' ? 'Connected wallet' : 'Owner wallet'
    return (
      <WalletApprovalScreen
        title={step.setup.mode === 'simple' ? 'Use Connected Wallet' : 'Use Owner Wallet'}
        subtitle={`${signer} signs one Ethereum Mainnet resolver transaction for ${step.setup.fullName}.`}
        walletSession={walletSession}
        label={step.setup.mode === 'simple' ? 'waiting for connected wallet transaction...' : 'waiting for owner wallet transaction...'}
        onCancel={() => onSetStep({
          kind: 'edit-profile-ens',
          identity: step.identity,
          registry: step.registry,
          returnTo: step.returnTo,
          ...(step.setup.mode === 'advanced' ? { initialView: 'advanced' as const } : {}),
        })}
      />
    )
  }

  const approval = publicProfileWalletApprovalView(step)
  return (
    <WalletApprovalScreen
      title={approval.title}
      subtitle={approval.subtitle}
      walletSession={walletSession}
      label={approval.label}
      onCancel={() => onSetStep(step.returnTo ?? { kind: 'continuity-public' })}
    />
  )
}

function publicProfileWalletApprovalView(step: StepOf<'public-profile-signing'>): {
  title: string
  subtitle: React.ReactNode
  label: string
} {
  if (usesAdvancedSetup(step)) {
    return {
      title: 'Use Wallet',
      subtitle: 'Sign the public profile and ERC-8004 token URI update.',
      label: 'waiting for wallet signature...',
    }
  }
  return {
    title: 'Use Wallet',
    subtitle: <FlowTimeline steps={EDIT_PROFILE_STEPS} current={5} />,
    label: 'waiting for wallet signature...',
  }
}

function usesAdvancedSetup(step: StepOf<'public-profile-signing'>): boolean {
  const state = (step.identity.state ?? {}) as Record<string, unknown>
  const custodyMode = step.profileUpdates?.custodyMode ?? readCustodyMode(state)
  const ownerAddress = step.profileUpdates?.ownerAddress ?? readOwnerAddressField(state)
  return custodyMode === 'advanced' && typeof ownerAddress === 'string' && ownerAddress.trim().length > 0
}

function isEditProfileStep(step: IdentityHubEnsStep): step is StepOf<
  | 'edit-profile-name'
  | 'edit-profile-description'
  | 'edit-profile-image'
  | 'edit-profile-review'
  | 'edit-profile-ens'
> {
  return step.kind === 'edit-profile-name'
    || step.kind === 'edit-profile-description'
    || step.kind === 'edit-profile-image'
    || step.kind === 'edit-profile-review'
    || step.kind === 'edit-profile-ens'
}
