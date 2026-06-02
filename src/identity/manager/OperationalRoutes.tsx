import React from 'react'
import type { ProfileUpdates } from './reducer.js'
import {
  runRebackupStorageSubmit,
} from './continuity/effects.js'
import {
  runPublicProfileStorageSubmit,
} from './profile/effects.js'
import { resolveVaultAddress } from './custody/transactions.js'
import { readCustodyMode } from './custody/state.js'
import { WalletApprovalScreen } from './shared/components/WalletApprovalScreen.js'
import { RebackupStorageScreen } from './continuity/RebackupStorageScreen.js'
import { BusyScreen } from './shared/components/BusyScreen.js'
import { ErrorScreen } from './shared/components/ErrorScreen.js'
import { OperationCompleteScreen } from './shared/components/OperationCompleteScreen.js'
import { UnlinkedIdentityScreen } from './shared/components/UnlinkedIdentityScreen.js'
import { invalidateOwnershipCache } from './shared/reconciliation/index.js'
import {
  EnsFlow,
  isEnsStep,
} from './ens/EnsFlow.js'
import { CustodyEditFlow, isCustodyEditStep } from './custody/CustodyEditFlow.js'
import { ContinuityRoutes, isContinuityStep } from './continuity/ContinuityRoutes.js'
import { SkillsRoutes, isSkillsStep } from './continuity/skills/SkillsRoutes.js'
import { StorageRoutes, isStorageStep } from './settings/StorageRoutes.js'
import { rebackupWalletApprovalView } from './shared/utils.js'
import type { IdentityManagerController } from './useController.js'

type IdentityManagerOperationalRoutesProps = {
  controller: IdentityManagerController
  footer: React.ReactNode
}

export const IdentityManagerOperationalRoutes: React.FC<IdentityManagerOperationalRoutesProps> = ({
  controller,
  footer,
}) => {
  const {
    config,
    reconciliation,
    step,
    walletSession,
    callbacks,
    custodyFlow,
    setStep,
    back,
    closeManager,
    setWalletSession,
    triggerRebackup,
    triggerPublicProfileSave,
    openTokenTransferFlow,
  } = controller

  if (isContinuityStep(step)) return <ContinuityRoutes controller={controller} footer={footer} />
  if (isSkillsStep(step)) return <SkillsRoutes controller={controller} footer={footer} />
  if (isStorageStep(step)) return <StorageRoutes controller={controller} footer={footer} />

  if (step.kind === 'operation-complete') {
    return (
      <OperationCompleteScreen
        message={step.message}
        onReturn={() => setStep({ kind: 'menu' })}
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
        onWithdrawFromVault={s => custodyFlow.beginWithdrawToken(s, s, 'ens')}
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
    const vaultRouted = Boolean(step.vaultAddress)
      && readCustodyMode(step.identity.state as Record<string, unknown> | undefined) === 'advanced'
    return (
      <WalletApprovalScreen
        title={approval.title}
        subtitle={custodyFlow.renderRebackupSubtitle(
          approval.subtitle,
          vaultRouted,
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
        title="Identity"
        label="preparing snapshot..."
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
        subtitle="Find agents this wallet owns or is linked to."
        walletSession={walletSession}
        label="waiting for wallet connection..."
        onCancel={() => setStep({ kind: 'menu' })}
      />
    )
  }

  if (step.kind === 'busy') {
    return (
      <BusyScreen
        title="Identity"
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
        closeLabel="Close"
        onBack={backStep => setStep(backStep)}
        onClose={closeManager}
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
