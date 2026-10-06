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
import { FieldList } from '../shared/components/FieldRow.js'
import { Paragraph } from '../../../ui/Paragraph.js'
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
  const tokenLabel = identity.agentId ? `#${identity.agentId}` : 'Unknown'
  const tokenOwner = identity.ownerAddress ?? identity.address

  if (step.kind === 'custody-model') {
    type Action = 'switch-advanced' | 'switch-simple' | 'resume-advanced' | 'cancel-advanced' | 'manage-operator-wallets' | 'back'
    const onChainCustody = reconciliation?.custody
    const midFlow = onChainCustody === 'mid-flow-uri-pending'
    const isAdvanced = onChainCustody === 'advanced' || midFlow || custodyMode === 'advanced'
    const subtitle = midFlow
      ? 'Advanced custody setup is unfinished. Resume it or cancel it.'
      : isAdvanced
        ? 'A Vault holds your token. Operators can save.'
        : 'Your wallet holds the token.'
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
        hint: 'Stay on Simple',
      })
    }
    if (!isAdvanced) {
      options.push({
        value: 'switch-advanced',
        label: 'Switch to Advanced',
        hint: 'Into a Vault',
      })
    } else {
      if (!midFlow) {
        options.push({
          value: 'switch-simple',
          label: 'Switch to Simple',
          hint: 'Back to your wallet',
        })
      }
      options.push({
        value: 'manage-operator-wallets',
        label: 'Manage Operators',
        hint: 'Add or remove',
      })
    }
    options.push({ value: 'back', label: 'Back', role: 'utility' })
    const notice = step.kind === 'custody-model' ? step.notice : undefined
    return (
      <Surface title="Custody Mode" subtitle={subtitle} footer={footerHint('↵ select · esc back')}>
        {notice ? (
          <Box marginBottom={1}>
            <Paragraph color={theme.accentPeriwinkle}>{notice}</Paragraph>
          </Box>
        ) : null}
        {(() => {
          const ensStatus = selectEnsStatus(identity)
          const lastBackup = lastBackupLabel(identity)
          return (
            <FieldList fields={[
              {
                label: 'ENS',
                value: ensStatus.kind === 'none'
                  ? 'Not linked'
                  : ensStatus.kind === 'issue'
                    ? `${ensStatus.name} (${ensValidationReasonText(ensStatus.reason)})`
                    : ensStatus.name,
                valueColor: ensStatus.kind === 'linked' ? theme.accentPeriwinkle : ensStatus.kind === 'issue' ? theme.accentError : theme.dim,
              },
              { label: 'Custody', value: modeLabel },
              { label: 'Owner', value: shortAddress(ownerAddress || tokenOwner) },
              isAdvanced && vaultAddress ? { label: 'Vault', value: shortAddress(vaultAddress) } : null,
              isAdvanced
                ? {
                    label: 'Operators',
                    value: approvedOperatorCount > 1
                      ? `${approvedOperatorCount} authorized`
                      : activeOperator
                        ? shortAddress(activeOperator)
                        : 'None yet',
                    ...(!activeOperator && approvedOperatorCount === 0 ? { valueColor: theme.dim } : {}),
                  }
                : null,
              { label: 'Last saved', value: lastBackup === 'never' ? 'Never' : lastBackup, ...(lastBackup === 'never' ? { valueColor: theme.dim } : {}) },
            ]} />
          )
        })()}
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
        title="Switch to Advanced?"
        subtitle="Your token moves into a Vault you control, so operator wallets can save for you."
        footer={footerHint('↵ select · esc back')}
      >
        <FieldList fields={[
          { label: 'Token', value: tokenLabel },
          agentName ? { label: 'Name', value: agentName } : null,
          { label: 'Owner wallet', value: shortAddress(ownerAddress || tokenOwner) },
        ]} />
        <Box marginTop={1}>
          <Select<Action>
            options={[
              { value: 'confirm', label: 'Switch to Advanced' },
              { value: 'transfer', label: 'Prepare Transfer Instead' },
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
      title="Switch to Simple?"
      subtitle="The token leaves the Vault and returns to your owner wallet."
      footer={footerHint('↵ select · esc back')}
    >
      <FieldList fields={[
        { label: 'Token', value: tokenLabel },
        agentName ? { label: 'Name', value: agentName } : null,
      ]} />
      <Box marginTop={1}>
        <Paragraph color={theme.accentError}>Operator wallets lose access right away.</Paragraph>
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'confirm', label: 'Switch to Simple' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          initialIndex={1}
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

