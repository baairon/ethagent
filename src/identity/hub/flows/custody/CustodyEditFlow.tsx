import React from 'react'
import type { Address } from 'viem'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { ProfileUpdates, Step } from '../../identityHubReducer.js'
import {
  displayCustodyMode,
  identityOwnerAddress,
  readCustodyMode,
  readIdentityStateString,
} from '../../model/custody.js'
import { ensValidationReasonText, selectEnsStatus } from '../../model/ens.js'
import { shortAddress } from '../../model/format.js'
import { lastBackupLabel } from '../../model/identity.js'
import {
  type AgentReconciliation,
} from '../../reconciliation/index.js'

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

type CustodyStep = Extract<Step, { kind: 'custody-model' | 'custody-advanced-confirm' | 'custody-simple-confirm' }>

interface CustodyEditFlowProps {
  step: CustodyStep
  reconciliation?: AgentReconciliation
  vaultAddress?: Address
  onSetStep: (step: Step) => void
  onSwitchToAdvanced: (returnTo: Step, profileUpdates: ProfileUpdates) => void
  onSwitchToSimple: (returnTo: Step, profileUpdates: ProfileUpdates) => void
  onWithdrawToken: (returnTo: Step) => void
  onReturnToVault: (returnTo: Step, vaultAddress: Address) => void
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
  onWithdrawToken,
  onReturnToVault,
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
    type Action = 'switch-advanced' | 'switch-simple' | 'resume-advanced' | 'cancel-advanced' | 'withdraw-token' | 'return-to-vault' | 'manage-operator-wallets' | 'back'
    const onChainCustody = reconciliation?.custody
    const midFlow = onChainCustody === 'mid-flow-uri-pending'
    const isAdvanced = onChainCustody === 'advanced' || midFlow || custodyMode === 'advanced'
    const vaultHolds = onChainCustody === 'advanced' || midFlow
    const subtitle = midFlow
      ? 'Advanced setup pending. This Vault holds your token. Finish by publishing the first onchain update.'
      : isAdvanced
        ? 'Advanced is active. Authorized operator wallets publish updates for this agent without an owner signature each time.'
        : 'Simple is active. One wallet owns the token and signs every update.'
    const modeLabel = midFlow ? 'Advanced (setup pending)' : displayCustodyMode(isAdvanced ? 'advanced' : 'simple')
    const options: Array<{ value: Action; role?: 'section' | 'utility'; label: string; hint?: string }> = []
    if (midFlow) {
      options.push({ value: 'resume-advanced', role: 'section', label: 'Resume Setup' })
      options.push({
        value: 'resume-advanced',
        label: 'Resume Advanced Setup',
        hint: 'Sign once to publish onchain and finish the Vault switch.',
      })
      options.push({
        value: 'cancel-advanced',
        label: 'Cancel Advanced Setup',
        hint: 'Unwrap the token back to the owner wallet and revert to simple.',
      })
    }
    options.push({ value: 'switch-advanced', role: 'section', label: 'Custody' })
    if (!isAdvanced) {
      options.push({
        value: 'switch-advanced',
        label: 'Switch to Advanced',
        hint: 'Deposit this token into its own Vault so operator wallets can publish updates onchain.',
      })
    } else {
      if (!midFlow) {
        options.push({
          value: 'switch-simple',
          label: 'Switch to Simple',
          hint: 'Unwrap the token and revoke operator delegations.',
        })
      }
      if (vaultHolds) {
        options.push({
          value: 'withdraw-token',
          label: 'Withdraw Token',
          hint: 'Unwrap this token to the owner wallet. Vault setup stays for easy redeposit.',
        })
      } else if (vaultAddress) {
        options.push({
          value: 'return-to-vault',
          label: 'Return Token to Vault',
          hint: 'Redeposit this token to its Vault. No redeploy, no operator re-add.',
        })
      }
      options.push({ value: 'manage-operator-wallets', role: 'section', label: 'Operators' })
      options.push({
        value: 'manage-operator-wallets',
        label: 'Manage Operators',
        hint: 'Add or revoke wallets that can publish updates onchain.',
      })
    }
    options.push({ value: 'back', role: 'section', label: 'Navigation' })
    options.push({ value: 'back', label: 'Back', hint: 'Return to Identity Hub', role: 'utility' })
    const notice = step.kind === 'custody-model' ? step.notice : undefined
    return (
      <Surface title="Custody Mode" subtitle={subtitle} footer={footerHint('enter select · esc back')}>
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
              if (choice === 'withdraw-token') return onWithdrawToken(returnTo ?? { kind: 'menu' })
              if (choice === 'return-to-vault') {
                if (!vaultAddress) return
                return onReturnToVault(returnTo ?? { kind: 'menu' }, vaultAddress)
              }
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
        subtitle="Move this token into its own Vault so authorized operator wallets can update this agent onchain without your signature each time."
        footer={footerHint('enter confirm, esc back')}
      >
        <Box flexDirection="column">
          <Row label="Token" value={tokenLabel} />
          {agentName ? <Row label="Name" value={agentName} /> : null}
          <Row label="Owner Wallet" value={shortAddress(ownerAddress || tokenOwner)} />
          <Text color={theme.textSubtle}>You sign once now to deposit token #{identity.agentId ?? 'unknown'} into a dedicated Vault.</Text>
          <Text color={theme.textSubtle}>This vault can hold only this ERC-8004 token.</Text>
          <Text color={theme.textSubtle}>Other agent tokens use their own vaults.</Text>
          <Text color={theme.textSubtle}>After that, operator wallets you authorize can publish updates for this agent.</Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.accentBlue}>Want a different wallet to be the owner?</Text>
            <Text color={theme.textSubtle}>Move the token there first via Prepare Token Transfer; your continuity files come along.</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Select<Action>
            options={[
              { value: 'confirm', role: 'section', label: 'Confirm' },
              { value: 'confirm', label: 'Yes, Switch to Advanced', hint: `Sign with ${shortAddress(ownerAddress || tokenOwner)} to deposit this token into its Vault` },
              { value: 'transfer', role: 'section', label: 'Move Token First' },
              { value: 'transfer', label: 'Prepare Token Transfer', hint: 'Move the token to a different wallet first, with snapshot handoff' },
              { value: 'back', role: 'section', label: 'Cancel' },
              { value: 'back', label: 'No, Go Back', hint: 'Return without changing custody', role: 'utility' },
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
      subtitle="Unwraps this ERC-8004 token from its Vault and returns it directly to the owner wallet."
      footer={footerHint('enter confirm · esc back')}
    >
      <Box flexDirection="column">
        <Row label="Token" value={tokenLabel} />
        {agentName ? <Row label="Name" value={agentName} /> : null}
        <Text> </Text>
        <Text color={theme.accentBlue}>Operators lose decrypt access on future snapshots immediately.</Text>
        <Text color={theme.textSubtle}>Operator approvals are cleared from local state for future snapshots. Revoke onchain via Manage Operators first if needed.</Text>
        <Text color={theme.textSubtle}>This switch calls the Vault unwrap function for this token, so the owner wallet must sign the transaction.</Text>
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={[
            { value: 'confirm', role: 'section', label: 'Confirm' },
            { value: 'confirm', label: 'Yes, Switch to Simple', hint: `Sign with the owner wallet to unwrap ${tokenLabel} from its Vault` },
            { value: 'back', role: 'section', label: 'Cancel' },
            { value: 'back', label: 'No, Go Back', hint: 'Return without changing custody', role: 'utility' },
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
