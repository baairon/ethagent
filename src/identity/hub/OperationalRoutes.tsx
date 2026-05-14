import React from 'react'
import { hasPendingPublish } from './continuity/state.js'
import type { ProfileUpdates } from './identityHubReducer.js'
import { clearPinataJwt, savePinataJwt } from '../storage/pinataJwt.js'
import {
  runRebackupStorageSubmit,
} from './continuity/effects.js'
import {
  runPublicProfileStorageSubmit,
} from './profile/effects.js'
import { resolveVaultAddress } from './custody/transactions.js'
import { WalletApprovalScreen } from './shared/components/WalletApprovalScreen.js'
import { RebackupStorageScreen } from './continuity/RebackupStorageScreen.js'
import { BusyScreen } from './shared/components/BusyScreen.js'
import { StorageCredentialScreen } from './settings/StorageCredentialScreen.js'
import {
  PrivateContinuityScreen,
  PublicProfileScreen,
} from './continuity/ContinuityDashboardScreen.js'
import { SkillsTreeScreen } from './continuity/skills/SkillsTreeScreen.js'
import { NewSkillScreen } from './continuity/skills/NewSkillScreen.js'
import { NewSkillVisibilityScreen } from './continuity/skills/NewSkillVisibilityScreen.js'
import { SkillActionsScreen } from './continuity/skills/SkillActionsScreen.js'
import { DeleteSkillConfirmScreen } from './continuity/skills/DeleteSkillConfirmScreen.js'
import { RecoveryConfirmScreen } from './continuity/RecoveryConfirmScreen.js'
import { SavePromptScreen } from './continuity/SavePromptScreen.js'
import { ErrorScreen } from './shared/components/ErrorScreen.js'
import { UnlinkedIdentityScreen } from './shared/components/UnlinkedIdentityScreen.js'
import { invalidateOwnershipCache } from './shared/reconciliation/index.js'
import {
  EnsFlow,
  isEnsStep,
} from './ens/EnsFlow.js'
import { CustodyEditFlow, isCustodyEditStep } from './custody/CustodyEditFlow.js'
import { rebackupWalletApprovalView } from './shared/utils.js'
import type { IdentityHubController } from './useIdentityHubController.js'

type IdentityHubOperationalRoutesProps = {
  controller: IdentityHubController
  footer: React.ReactNode
}

export const IdentityHubOperationalRoutes: React.FC<IdentityHubOperationalRoutesProps> = ({
  controller,
  footer,
}) => {
  const {
    mode,
    config,
    onComplete,
    identity,
    reconciliation,
    step,
    walletSession,
    restoreProgress,
    jwtSaved,
    callbacks,
    custodyFlow,
    continuityReady,
    workingStatus,
    setStep,
    back,
    closeHub,
    setWalletSession,
    setJwtSaved,
    setCopyNotice,
    handleStepError,
    resolveRegistryForIdentity,
    triggerRebackup,
    triggerPublicProfileSave,
    openTokenTransferFlow,
    openPublicProfileEdit,
    openContinuityFile,
    openSkillFile,
    openSkillsFolder,
    createSkill,
    deleteSkill,
    setSkillVisibility,
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
        subtitle="Wallet signature decrypts the latest saved snapshot and restores SOUL.md, MEMORY.md, and skills."
        walletSession={walletSession}
        label={restoreProgress?.label ?? 'fetching latest snapshot from onchain...'}
        onCancel={() => setStep(step.back)}
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

  if (step.kind === 'continuity-skills-tree') {
    return (
      <SkillsTreeScreen
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        notice={step.notice}
        editorOpened={step.editorOpened}
        footer={footer}
        onOpenSkill={relativePath => setStep({ kind: 'continuity-skill-actions', relativePath })}
        onNewSkill={() => setStep({ kind: 'continuity-skill-new' })}
        onOpenFolder={() => { void openSkillsFolder() }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-actions') {
    return (
      <SkillActionsScreen
        identity={identity}
        relativePath={step.relativePath}
        {...(step.notice ? { notice: step.notice } : {})}
        footer={footer}
        onOpenSkill={relativePath => { void openSkillFile(relativePath) }}
        onSetVisibility={(relativePath, visibility) => { void setSkillVisibility(relativePath, visibility) }}
        onDelete={relativePath => setStep({ kind: 'continuity-skill-delete-confirm', target: { kind: 'skill', relativePath } })}
        onBack={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-new') {
    return (
      <NewSkillScreen
        error={step.error}
        footer={footer}
        onSubmit={name => setStep({ kind: 'continuity-skill-new-visibility', name })}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-new-visibility') {
    return (
      <NewSkillVisibilityScreen
        name={step.name}
        {...(step.error ? { error: step.error } : {})}
        footer={footer}
        onSelect={visibility => { void createSkill(step.name, visibility) }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'continuity-skill-delete-confirm') {
    return (
      <DeleteSkillConfirmScreen
        identity={identity}
        target={step.target}
        footer={footer}
        onConfirm={() => { void deleteSkill(step.target.relativePath) }}
        onCancel={back}
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

  if (step.kind === 'storage-credential' || step.kind === 'storage-credential-input' || step.kind === 'storage-credential-forget-confirm') {
    return (
      <StorageCredentialScreen
        step={step}
        hasCredential={jwtSaved}
        footer={footer}
        onEdit={() => setStep({ kind: 'storage-credential-input' })}
        onForget={() => setStep({ kind: 'storage-credential-forget-confirm' })}
        onConfirmForget={async () => {
          await clearPinataJwt().catch(() => {})
          setJwtSaved(false)
          setCopyNotice('IPFS storage credential removed.')
          setStep({ kind: 'menu' })
        }}
        onSubmit={async input => {
          try {
            await savePinataJwt(input)
            setJwtSaved(true)
            setCopyNotice('IPFS storage credential saved.')
            setStep({ kind: 'menu' })
          } catch (err: unknown) {
            setStep({ kind: 'storage-credential-input', error: (err as Error).message })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (isEnsStep(step)) {
    return (
      <EnsFlow
        step={step}
        walletSession={walletSession}
        reconciliation={reconciliation}
        onSetStep={setStep}
        onBack={back}
        onWalletReady={setWalletSession}
        onTriggerRebackup={triggerRebackup}
        onTriggerPublicProfileSave={triggerPublicProfileSave}
        onWithdrawTokenForEns={currentStep => custodyFlow.beginWithdrawToken(currentStep, currentStep, 'ens')}
      />
    )
  }

  {
    const custodyView = custodyFlow.renderCustodyStep()
    if (custodyView) return custodyView
  }

  if (isCustodyEditStep(step)) {
    return (
      <CustodyEditFlow
        step={step}
        reconciliation={reconciliation}
        vaultAddress={resolveVaultAddress(step.identity, config?.erc8004?.operatorVaults)}
        onSetStep={setStep}
        onSwitchToAdvanced={(returnTo, updates) => custodyFlow.beginVaultDeposit(step, returnTo, updates)}
        onSwitchToSimple={(returnTo, updates) => custodyFlow.beginVaultUnwrap(step, returnTo, updates)}
        onWithdrawToken={returnTo => custodyFlow.beginWithdrawToken(step, returnTo)}
        onReturnToVault={(returnTo, vaultAddress) => custodyFlow.beginReturnToVault(step, returnTo, vaultAddress)}
        onResumeAdvanced={returnTo => {
          const vaultAddress = resolveVaultAddress(step.identity, config?.erc8004?.operatorVaults)
          const updates: ProfileUpdates = {
            custodyMode: 'advanced',
            ownerAddress: step.identity.ownerAddress ?? step.identity.address,
            ...(vaultAddress ? { operatorVaultAddress: vaultAddress } : {}),
          }
          triggerRebackup(returnTo, updates, vaultAddress ? { vaultAddress } : undefined)
        }}
        onManageOperatorWallets={() => {
          setStep({ kind: 'manage-ens-operators', identity: step.identity, registry: step.registry, returnTo: step })
        }}
        onPrepareTransfer={openTokenTransferFlow}
        onBack={back}
      />
    )
  }

  if (step.kind === 'rebackup-signing') {
    const approval = rebackupWalletApprovalView(step.identity, step.profileUpdates)
    return (
      <WalletApprovalScreen
        title={approval.title}
        subtitle={custodyFlow.renderRebackupSubtitle(
          approval.subtitle,
          Boolean(step.vaultAddress),
        )}
        walletSession={walletSession}
        label={approval.label}
        onCancel={() => setStep(step.returnTo ?? { kind: 'menu' })}
      />
    )
  }

  if (step.kind === 'rebackup-start') {
    return (
      <BusyScreen
        title="Identity Hub"
        label="preparing encrypted snapshot..."
        onCancel={back}
      />
    )
  }

  if (step.kind === 'rebackup-storage') {
    return (
      <RebackupStorageScreen
        step={step}
        footer={footer}
        onSubmit={async input => {
          try {
            await runRebackupStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            setStep({ ...step, error: (err as Error).message })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'public-profile-storage') {
    return (
      <RebackupStorageScreen
        step={step}
        footer={footer}
        onSubmit={async input => {
          try {
            await runPublicProfileStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            setStep({ ...step, error: (err as Error).message })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'restore-wallet') {
    return (
      <WalletApprovalScreen
        title="Connect Wallet"
        subtitle="Find agents this wallet owns, whether held directly or linked to it."
        walletSession={walletSession}
        label="waiting for wallet connection..."
        onCancel={() => setStep({ kind: 'menu' })}
      />
    )
  }

  if (step.kind === 'busy') {
    return (
      <BusyScreen
        title="Identity Hub"
        label={step.label}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'error') {
    return (
      <ErrorScreen
        error={step.error}
        back={step.back}
        footer={footer}
        closeLabel={mode === 'first-run' ? 'Skip Identity For Now' : 'Close Identity Hub'}
        closeHint={mode === 'first-run' ? 'Continue First-Run Setup without an agent identity' : 'Return to chat without retrying'}
        onBack={backStep => setStep(backStep)}
        onClose={closeHub}
      />
    )
  }

  if (step.kind === 'identity-unlinked') {
    return (
      <UnlinkedIdentityScreen
        identity={step.identity}
        {...(step.identity.agentId ? { agentId: step.identity.agentId } : {})}
        onLoadAgent={() => setStep({ kind: 'restore-network', ownerHandle: '', purpose: 'switch' })}
        onOpenMenu={() => setStep({ kind: 'menu' })}
        onRetry={() => {
          invalidateOwnershipCache()
          setStep(step.back)
        }}
        onCancel={() => setStep(step.back)}
      />
    )
  }

  return null
}
