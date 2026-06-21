import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { openImageFilePicker } from '../../profile/imagePicker.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { ProfileUpdates, Step } from '../reducer.js'
import { readCustodyMode } from '../custody/state.js'
import { OperatorWalletsScreen } from './EnsOperatorWalletsScreen.js'
import { EditProfileFlow } from '../profile/EditProfileFlow.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import type { AgentReconciliation } from '../shared/reconciliation/index.js'

type StepOf<K extends Step['kind']> = Extract<Step, { kind: K }>

type IdentityManagerEnsStep = StepOf<
  | 'manage-ens-operators'
  | 'edit-profile-menu'
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
  step: IdentityManagerEnsStep
  walletSession: BrowserWalletReady | null
  reconciliation: AgentReconciliation
  onSetStep: (step: Step) => void
  onBack: () => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onTriggerRebackup: (backStep: Step, profileUpdates?: ProfileUpdates) => void
  onTriggerPublicProfileSave: (backStep: Step, profileUpdates: ProfileUpdates) => void
  onWithdrawFromVault: (step: IdentityManagerEnsStep) => void
}

export function isEnsStep(step: Step): step is IdentityManagerEnsStep {
  return step.kind === 'manage-ens-operators'
    || step.kind === 'edit-profile-menu'
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
  onWithdrawFromVault,
}) => {
  if (step.kind === 'edit-profile-ens'
    && (reconciliation.custody === 'advanced' || reconciliation.custody === 'mid-flow-uri-pending')) {
    return <EnsVaultGate onWithdraw={() => onWithdrawFromVault(step)} onBack={onBack} />
  }

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
    const editStep = step
    const menuFromDrafts = (drafts: { name?: string; description?: string; imagePath?: string }) => {
      const next: Step = {
        kind: 'edit-profile-menu',
        identity: editStep.identity,
        registry: editStep.registry,
        returnTo: 'returnTo' in editStep ? editStep.returnTo : undefined,
        ...(drafts.name !== undefined ? { name: drafts.name } : {}),
        ...(drafts.description !== undefined ? { description: drafts.description } : {}),
        ...(drafts.imagePath !== undefined ? { imagePath: drafts.imagePath } : {}),
      }
      onSetStep(next)
    }
    const currentDrafts = () => ({
      name: 'name' in editStep ? editStep.name : undefined,
      description: 'description' in editStep ? editStep.description : undefined,
      imagePath: 'imagePath' in editStep ? editStep.imagePath : undefined,
    })
    return (
      <EditProfileFlow
        step={step}
        reconciliation={reconciliation}
        onSelectField={field => {
          if (editStep.kind !== 'edit-profile-menu') return
          const carry = currentDrafts()
          if (field === 'name') {
            onSetStep({
              kind: 'edit-profile-name',
              identity: editStep.identity,
              registry: editStep.registry,
              ...(carry.name !== undefined ? { name: carry.name } : {}),
              ...(carry.description !== undefined ? { description: carry.description } : {}),
              ...(carry.imagePath !== undefined ? { imagePath: carry.imagePath } : {}),
              returnTo: editStep.returnTo,
            })
            return
          }
          if (field === 'description') {
            onSetStep({
              kind: 'edit-profile-description',
              identity: editStep.identity,
              registry: editStep.registry,
              ...(carry.name !== undefined ? { name: carry.name } : {}),
              ...(carry.description !== undefined ? { description: carry.description } : {}),
              ...(carry.imagePath !== undefined ? { imagePath: carry.imagePath } : {}),
              returnTo: editStep.returnTo,
            })
            return
          }
          onSetStep({
            kind: 'edit-profile-image',
            identity: editStep.identity,
            registry: editStep.registry,
            ...(carry.name !== undefined ? { name: carry.name } : {}),
            ...(carry.description !== undefined ? { description: carry.description } : {}),
            ...(carry.imagePath !== undefined ? { imagePath: carry.imagePath } : {}),
            returnTo: editStep.returnTo,
          })
        }}
        onSaveProfile={() => {
          if (editStep.kind !== 'edit-profile-menu') return
          const carry = currentDrafts()
          const savedName = (editStep.identity.state as Record<string, unknown> | undefined)?.['name'] as string | undefined
          const savedDescription = (editStep.identity.state as Record<string, unknown> | undefined)?.['description'] as string | undefined
          onSetStep({
            kind: 'edit-profile-review',
            identity: editStep.identity,
            registry: editStep.registry,
            name: carry.name ?? savedName ?? '',
            description: carry.description ?? savedDescription ?? '',
            ...(carry.imagePath !== undefined ? { imagePath: carry.imagePath } : {}),
            returnTo: editStep.returnTo,
          })
        }}
        onNameSubmit={name => {
          if (editStep.kind !== 'edit-profile-name') return
          menuFromDrafts({ ...currentDrafts(), name })
        }}
        onDescriptionSubmit={description => {
          if (editStep.kind !== 'edit-profile-description') return
          menuFromDrafts({ ...currentDrafts(), description })
        }}
        onIconSubmit={iconPath => {
          if (editStep.kind !== 'edit-profile-image') return
          if (iconPath === undefined) {
            menuFromDrafts(currentDrafts())
            return
          }
          menuFromDrafts({ ...currentDrafts(), imagePath: iconPath })
        }}
        onIconPick={() => {
          if (editStep.kind !== 'edit-profile-image') return
          const iconStep = editStep
          void openImageFilePicker()
            .then(result => {
              if (!result.ok) {
                onSetStep({ ...iconStep, error: result.cancelled ? 'icon selection cancelled.' : `${result.error}` })
                return
              }
              menuFromDrafts({ ...currentDrafts(), imagePath: result.file })
            })
            .catch((err: unknown) => {
              onSetStep({ ...iconStep, error: `${(err as Error).message}` })
            })
        }}
        onReviewSave={() => {
          if (editStep.kind !== 'edit-profile-review') return
          const updates: ProfileUpdates = {
            name: editStep.name,
            description: editStep.description,
            ...(editStep.imagePath !== undefined ? { imagePath: editStep.imagePath } : {}),
          }
          onTriggerPublicProfileSave(editStep.returnTo ?? { kind: 'continuity-public' }, updates)
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
        onBackToEditMenu={() => menuFromDrafts(currentDrafts())}
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
        label={step.clearRecords ? 'waiting for wallet to clear ENS records...' : 'waiting for wallet to update ENS records...'}
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
        label="waiting for wallet to register the ENS name..."
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
        label="waiting for wallet to set ENS records..."
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
    subtitle: 'Sign the public profile and ERC-8004 token URI update.',
    label: 'waiting for wallet signature...',
  }
}

function usesAdvancedSetup(step: StepOf<'public-profile-signing'>): boolean {
  const state = (step.identity.state ?? {}) as Record<string, unknown>
  const custodyMode = step.profileUpdates?.custodyMode ?? readCustodyMode(state)
  const ownerAddress = step.profileUpdates?.ownerAddress ?? readOwnerAddressField(state)
  return custodyMode === 'advanced' && typeof ownerAddress === 'string' && ownerAddress.trim().length > 0
}

function isEditProfileStep(step: IdentityManagerEnsStep): step is StepOf<
  | 'edit-profile-menu'
  | 'edit-profile-name'
  | 'edit-profile-description'
  | 'edit-profile-image'
  | 'edit-profile-review'
  | 'edit-profile-ens'
> {
  return step.kind === 'edit-profile-menu'
    || step.kind === 'edit-profile-name'
    || step.kind === 'edit-profile-description'
    || step.kind === 'edit-profile-image'
    || step.kind === 'edit-profile-review'
    || step.kind === 'edit-profile-ens'
}

const EnsVaultGate: React.FC<{ onWithdraw: () => void; onBack: () => void }> = ({ onWithdraw, onBack }) => (
  <Surface
    title="ENS Name"
    footer={<Text color={theme.dim}>Token is in the Vault · ↵ select · esc back</Text>}
  >
    <Box marginBottom={1}>
      <Text color={theme.textSubtle}>The owner wallet must hold the token directly to sign the ENS setup transaction.</Text>
    </Box>
    <Select<'withdraw' | 'back'>
      options={[
        { value: 'withdraw', role: 'section', label: 'Proceed' },
        { value: 'withdraw', label: 'Withdraw Token from Vault' },
        { value: 'back', role: 'section', label: 'Navigation' },
        { value: 'back', label: 'Back', role: 'utility' },
      ]}
      hintLayout="inline"
      onSubmit={choice => { if (choice === 'withdraw') onWithdraw(); else onBack() }}
      onCancel={onBack}
    />
  </Surface>
)
