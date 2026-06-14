import React from 'react'
import type { Address } from 'viem'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { ProfileUpdates, Step } from '../reducer.js'
import {
  displayCustodyMode,
  identityOwnerAddress,
  readCustodyMode,
  readIdentityStateString,
} from './state.js'
import { ensValidationReasonText, selectEnsStatus } from '../ens/state.js'
import { shortAddress } from '../shared/model/format.js'
import { lastBackupLabel } from '../profile/identity.js'
import {
  type AgentReconciliation,
} from '../shared/reconciliation/index.js'

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

type CustodyStep = Extract<Step, { kind: 'custody-model' | 'custody-advanced-confirm' | 'custody-simple-confirm' }>

interface CustodyEditFlowProps {
  step: CustodyStep
  reconciliation?: AgentReconciliation
  vaultAddress?: Address
  onSetStep: (step: Step) => void
  onSwitchToAdvanced: (returnTo: Step, profileUpdates: ProfileUpdates) => void
  onSwitchToSimple: (returnTo: Step, profileUpdates: ProfileUpdates) => void
  onResumeAdvanced: (returnTo: Step) => void
  onManageOperatorWallets: () => void
  onPrepareTransfer: () => void
  onBack: () => void
}

export function isCustodyEditStep(step: Step): step is CustodyStep {
  return step.kind === 'custody-model'
    || step.kind === 'custody-advanced-confirm'
    || step.kind === 'custody-simple-confirm'
}

export const CustodyEditFlow: React.FC<CustodyEditFlowProps> = ({
  step,
  reconciliation,
  vaultAddress,
  onSetStep,
  onSwitchToAdvanced,
  onSwitchToSimple,
  onResumeAdvanced,
  onManageOperatorWallets,
  onPrepareTransfer,
  onBack,
}) => {
  const identity = step.identity
  const registry = step.registry
  const returnTo = step.returnTo
  const state = (identity.state ?? {}) as Record<string, unknown>
  const custodyMode = readCustodyMode(state)
  const ownerAddress = identityOwnerAddress(identity, reconciliation?.onChainOwner)
  const activeOperator = readIdentityStateString(state, 'activeOperatorAddress')
  const approvedOperatorCount = Array.isArray(state.approvedOperatorWallets)
    ? (state.approvedOperatorWallets as unknown[]).length
    : 0
  const agentName = readIdentityStateString(state, 'name')
  const tokenLabel = identity.agentId ? `Token #${identity.agentId}` : 'Token #unknown'
  const tokenOwner = identity.ownerAddress ?? identity.address

  if (step.kind === 'custody-model') {
    type Action = 'switch-advanced' | 'switch-simple' | 'resume-advanced' | 'cancel-advanced' | 'manage-operator-wallets' | 'back'
    const onChainCustody = reconciliation?.custody
    const midFlow = onChainCustody === 'mid-flow-uri-pending'
    const isAdvanced = onChainCustody === 'advanced' || midFlow || custodyMode === 'advanced'
    const vaultHolds = onChainCustody === 'advanced' || midFlow
    const subtitle = midFlow
      ? 'Advanced setup pending.'
      : isAdvanced
        ? 'Advanced custody active.'
        : 'Simple custody active.'
    const modeLabel = midFlow ? 'Advanced (setup pending)' : displayCustodyMode(isAdvanced ? 'advanced' : 'simple')
    const options: Array<{ value: Action; role?: 'section' | 'utility'; label: string; hint?: string }> = []
    if (midFlow) {
      options.push({
        value: 'resume-advanced',
        label: 'Resume Advanced Setup',
      })
      options.push({
        value: 'cancel-advanced',
        label: 'Cancel Advanced Setup',
      })
    }
    if (!isAdvanced) {
      options.push({
        value: 'switch-advanced',
        label: 'Switch to Advanced',
        hint: 'Operators publish',
      })
    } else {
      if (!midFlow) {
        options.push({
          value: 'switch-simple',
          label: 'Switch to Simple',
          hint: 'Remove Vault',
        })
      }
      options.push({
        value: 'manage-operator-wallets',
        label: 'Manage Operators',
        hint: 'Add or revoke',
      })
    }
    options.push({ value: 'back', label: 'Back', role: 'utility' })
    const notice = step.kind === 'custody-model' ? step.notice : undefined
    return (
      <Surface title="Custody Mode" subtitle={subtitle} footer={footerHint('↵ select · esc back')}>
        {notice ? (
          <Box marginBottom={1}>
            <Text color={theme.accentPeriwinkle}>{notice}</Text>
          </Box>
        ) : null}
        <Box flexDirection="column">
          {(() => {
            const ensStatus = selectEnsStatus(identity)
            return (
              <Text>
                <Text color={theme.dim}>{'ENS'.padEnd(14)}</Text>
                {ensStatus.kind === 'linked'
                  ? <Text color={theme.accentPeriwinkle}>{ensStatus.name}</Text>
                  : ensStatus.kind === 'issue'
                    ? <Text color={theme.accentError}>{ensStatus.name} ({ensValidationReasonText(ensStatus.reason)})</Text>
                    : <Text color={theme.dim}>Not Linked</Text>}
              </Text>
            )
          })()}
          <Row label="Custody" value={modeLabel} />
          <Row label="Owner" value={shortAddress(ownerAddress || tokenOwner)} />
          {isAdvanced && vaultAddress ? <Row label="Vault" value={shortAddress(vaultAddress)} /> : null}
          {isAdvanced ? (
            <Row
              label="Operators"
              value={approvedOperatorCount > 1
                ? `${approvedOperatorCount} authorized${activeOperator ? ` (active ${shortAddress(activeOperator)})` : ''}`
                : activeOperator
                  ? shortAddress(activeOperator)
                  : 'None Authorized'}
              muted={!activeOperator && approvedOperatorCount === 0}
            />
          ) : null}
          {(() => {
            const lastBackup = lastBackupLabel(identity)
            return <Row label="Last Saved" value={lastBackup} muted={lastBackup === 'never'} />
          })()}
        </Box>
        <Box marginTop={1}>
          <Select<Action>
            options={options}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return onBack()
              if (choice === 'manage-operator-wallets') return onManageOperatorWallets()
              if (choice === 'resume-advanced') return onResumeAdvanced(returnTo ?? { kind: 'menu' })
              if (choice === 'cancel-advanced') {
                onSetStep({ kind: 'custody-simple-confirm', identity, registry, returnTo })
                return
              }
              if (choice === 'switch-advanced') {
                onSetStep({ kind: 'custody-advanced-confirm', identity, registry, returnTo })
                return
              }
              if (choice === 'switch-simple') {
                onSetStep({ kind: 'custody-simple-confirm', identity, registry, returnTo })
                return
              }
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  if (step.kind === 'custody-advanced-confirm') {
    type Action = 'confirm' | 'transfer' | 'back'
    return (
      <Surface
        title="Switch to Advanced"
        subtitle="Token goes into a Vault. Operators update onchain without your sig each time."
        footer={footerHint('↵ confirm · esc back')}
      >
        <Box flexDirection="column">
          <Row label="Token" value={tokenLabel} />
          {agentName ? <Row label="Name" value={agentName} /> : null}
          <Row label="Owner Wallet" value={shortAddress(ownerAddress || tokenOwner)} />
        </Box>
        <Box marginTop={1}>
          <Select<Action>
            options={[
              { value: 'confirm', label: 'Yes, Switch to Advanced' },
              { value: 'transfer', label: 'Prepare Token Transfer' },
              { value: 'back', label: 'Back', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => {
              if (choice === 'back') return onBack()
              if (choice === 'transfer') return onPrepareTransfer()
              const updates: ProfileUpdates = {
                custodyMode: 'advanced',
                ownerAddress: ownerAddress || tokenOwner,
                bumpRestoreAccessEpoch: true,
                custodyPhase: 'switch-advanced',
              }
              onSwitchToAdvanced(returnTo ?? { kind: 'menu' }, updates)
            }}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  type Action = 'confirm' | 'back'
  return (
    <Surface
      title="Switch to Simple"
      subtitle="Withdraws token from Vault to owner wallet."
      footer={footerHint('↵ confirm · esc back')}
    >
      <Box flexDirection="column">
        <Row label="Token" value={tokenLabel} />
        {agentName ? <Row label="Name" value={agentName} /> : null}
        <Text color={theme.accentError}>Operators lose access immediately.</Text>
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'confirm', label: 'Yes, Switch to Simple' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'back') return onBack()
            const updates: ProfileUpdates = {
              custodyMode: 'simple',
              bumpRestoreAccessEpoch: true,
              custodyPhase: 'switch-simple',
              approvedOperatorWallets: [],
              activeOperatorAddress: '',
              operatorVaultAddress: '',
            }
            onSwitchToSimple(returnTo ?? { kind: 'menu' }, updates)
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

const Row: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <Text>
    <Text color={theme.dim}>{label.padEnd(14)}</Text>
    <Text color={muted ? theme.dim : theme.text}>{value}</Text>
  </Text>
)
