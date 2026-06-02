import React from 'react'
import { hasPendingPublish } from './state.js'
import { RecoveryConfirmScreen } from './RecoveryConfirmScreen.js'
import { SavePromptScreen } from './SavePromptScreen.js'
import { PrivateContinuityScreen, PublicProfileScreen } from './ContinuityDashboardScreen.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import type { Step } from '../reducer.js'
import type { IdentityManagerController } from '../useController.js'

type StepOf<K extends Step['kind']> = Extract<Step, { kind: K }>

type ContinuityStep = StepOf<
  | 'rebackup-confirm'
  | 'save-prompt'
  | 'recovery-refetch-confirm'
  | 'recovery-refetching'
  | 'continuity-overwrite-confirm'
  | 'continuity-private'
  | 'continuity-public'
>

export function isContinuityStep(step: Step): step is ContinuityStep {
  return step.kind === 'rebackup-confirm'
    || step.kind === 'save-prompt'
    || step.kind === 'recovery-refetch-confirm'
    || step.kind === 'recovery-refetching'
    || step.kind === 'continuity-overwrite-confirm'
    || step.kind === 'continuity-private'
    || step.kind === 'continuity-public'
}

type ContinuityRoutesProps = {
  controller: IdentityManagerController
  footer: React.ReactNode
}

export const ContinuityRoutes: React.FC<ContinuityRoutesProps> = ({ controller, footer }) => {
  const {
    config,
    onComplete,
    identity,
    step,
    walletSession,
    restoreProgress,
    continuityReady,
    workingStatus,
    setStep,
    back,
    handleStepError,
    resolveRegistryForIdentity,
    triggerRebackup,
    openPublicProfileEdit,
    openContinuityFile,
  } = controller

  if (step.kind === 'rebackup-confirm') {
    return (
      <RecoveryConfirmScreen
        mode="publish"
        workingStatus={workingStatus}
        footer={footer}
        onConfirm={() => triggerRebackup(step.back)}
        onBack={back}
      />
    )
  }

  if (step.kind === 'save-prompt') {
    return (
      <SavePromptScreen
        workingStatus={workingStatus}
        footer={footer}
        onSelect={action => {
          if (action === 'save-now') {
            triggerRebackup(step.back)
            return
          }
          onComplete({ kind: 'cancel' })
        }}
        onCancel={() => onComplete({ kind: 'cancel' })}
      />
    )
  }

  if (step.kind === 'recovery-refetch-confirm') {
    return (
      <RecoveryConfirmScreen
        mode="refetch"
        workingStatus={workingStatus}
        pendingPublish={hasPendingPublish(identity)}
        footer={footer}
        onConfirm={() => {
          if (!identity) return
          const registry = resolveRegistryForIdentity(identity)
          if (!registry) {
            handleStepError(new Error('no agent registry configured for this identity'), step.back)
            return
          }
          setStep({ kind: 'recovery-refetching', identity, registry, back: step.back })
        }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'recovery-refetching') {
    return (
      <WalletApprovalScreen
        title="Refetch Latest Snapshot"
        subtitle="Decrypts and restores SOUL.md, MEMORY.md, and skills."
        walletSession={walletSession}
        label={restoreProgress?.label ?? (walletSession ? 'waiting for your signature...' : 'fetching snapshot...')}
        onCancel={() => setStep(step.back)}
      />
    )
  }

  if (step.kind === 'continuity-overwrite-confirm') {
    return (
      <RecoveryConfirmScreen
        mode="restore"
        workingStatus={workingStatus}
        footer={footer}
        onConfirm={() => setStep(step.next)}
        onBack={() => setStep(step.back)}
      />
    )
  }

  if (step.kind === 'continuity-private') {
    return (
      <PrivateContinuityScreen
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        ready={continuityReady}
        notice={step.notice}
        footer={footer}
        editorOpened={step.editorOpened}
        onOpenSoul={() => { void openContinuityFile('soul') }}
        onOpenMemory={() => { void openContinuityFile('memory') }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'continuity-public') {
    return (
      <PublicProfileScreen
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        ready={continuityReady}
        notice={step.notice}
        footer={footer}
        editorOpened={step.editorOpened}
        onEditProfile={() => openPublicProfileEdit({ kind: 'continuity-public' })}
        onBack={back}
      />
    )
  }

  return null
}
