import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { openImageFilePicker } from '../../profile/imagePicker.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { ProfileUpdates, Step } from '../reducer.js'
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
        title={step.clearRecords ? `Unlink ${step.fullName}` : `Link ${step.fullName}`}
        subtitle={step.clearRecords
          ? 'Approve one transaction on Ethereum Mainnet to clear its agent records. It needs gas.'
          : 'Approve one transaction on Ethereum Mainnet to set its agent records. It needs gas.'}
        walletSession={walletSession}
        label="Waiting for your wallet…"
        onCancel={() => onSetStep({ kind: 'edit-profile-ens', identity: step.identity, registry: step.registry, returnTo: step.returnTo })}
      />
    )
  }

  if (step.kind === 'ens-setup-registry-tx') {
    return (
      <WalletApprovalScreen
        title={`Create ${step.setup.fullName}`}
        subtitle={setupStepLine(step.setup, 1, 'register the subdomain')}
        walletSession={walletSession}
        label="Waiting for your wallet…"
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
    return (
      <WalletApprovalScreen
        title={`Create ${step.setup.fullName}`}
        subtitle={setupStepLine(step.setup, step.setup.txCount, 'set its records')}
        walletSession={walletSession}
        label="Waiting for your wallet…"
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

function publicProfileWalletApprovalView(_step: StepOf<'public-profile-signing'>): {
  title: string
  subtitle: React.ReactNode
  label: string
} {
  return {
    title: 'Publish Profile',
    subtitle: 'Approve in your wallet to publish your profile and point your token at it.',
    label: 'Waiting for your wallet…',
  }
}

function setupStepLine(setup: { txCount: number; mode: 'simple' | 'advanced' }, index: number, action: string): string {
  const signer = setup.mode === 'simple' ? 'your wallet' : 'your owner wallet'
  const prefix = setup.txCount > 1 ? `Transaction ${index} of ${setup.txCount}: ${action}.` : `${action.charAt(0).toUpperCase()}${action.slice(1)}.`
  return `${prefix} Approve it in ${signer}. It needs gas on Ethereum Mainnet.`
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
    subtitle="Your token is in the Vault. The owner wallet must hold it directly to set up a name."
    footer={<Text color={theme.dim}>↵ select · esc back</Text>}
  >
    <Select<'withdraw' | 'back'>
      options={[
        { value: 'withdraw', label: 'Withdraw Token from Vault', hint: 'You can return it afterwards' },
        { value: 'back', label: 'Back', role: 'utility' },
      ]}
      hintLayout="inline"
      onSubmit={choice => { if (choice === 'withdraw') onWithdraw(); else onBack() }}
      onCancel={onBack}
    />
  </Surface>
)
