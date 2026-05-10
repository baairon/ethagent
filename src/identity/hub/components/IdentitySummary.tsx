import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import {
  displayCustodyMode,
  identityOwnerAddress,
  readCustodyMode,
  readIdentityStateString,
} from '../model/custody.js'
import {
  hasPendingPublish,
  localChangeStatusView,
  type LocalChangeStatusView,
} from '../model/continuity.js'
import { ensValidationReasonText, selectEnsStatus } from '../model/ens.js'
import { shortAddress } from '../model/format.js'
import { identitySummaryRows, lastBackupLabel } from '../model/identity.js'
import { transferSnapshotView, type TransferSnapshotView } from '../model/transfer.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

interface IdentitySummaryProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  hideLocalChanges?: boolean
  tokenLinked?: boolean
  onchainOwner?: string
}

export const IdentitySummary: React.FC<IdentitySummaryProps> = ({ identity, config, workingStatus, hideLocalChanges = false, tokenLinked = true, onchainOwner }) => {
  if (!identity) {
    return (
      <Text color={theme.dim}>No agent yet. Create or load one.</Text>
    )
  }

  const rows = identitySummaryRows(identity, config)
  const lastBackup = lastBackupLabel(identity)
  const stateName = readIdentityStateString(identity.state, 'name')

  const row = (label: string) => rows.find(item => item.label === label)
  const localChangeStatus = localChangeStatusView(workingStatus)

  const ensStatus = selectEnsStatus(identity)
  const custodyMode = readCustodyMode(identity.state)
  const activeOperator = readIdentityStateString(identity.state, 'activeOperatorAddress')
  const approvedOperatorCount = Array.isArray((identity.state as Record<string, unknown> | undefined)?.approvedOperatorWallets)
    ? ((identity.state as Record<string, unknown>).approvedOperatorWallets as unknown[]).length
    : 0
  const ownerAddress = identityOwnerAddress(identity, onchainOwner)
  const transferSnapshot = transferSnapshotView(identity)

  const tokenValue = row('token')?.value ?? 'Not Created'
  const networkValue = row('network')?.value ?? 'Unknown'
  const tokenLine = identity.agentId
    ? `${tokenValue} · ${displayValue(networkValue)}`
    : displayValue(tokenValue)

  return (
    <Box flexDirection="column">
      <Text color={theme.accentPeriwinkle} bold>{stateName || 'Active Agent'}</Text>
      <Text color={identity.agentId ? theme.text : theme.dim} bold={Boolean(identity.agentId)}>{tokenLine}</Text>
      <Text>
        <Text color={theme.dim}>{'ENS'.padEnd(12)}</Text>
        {ensStatus.kind === 'linked'
          ? <Text color={theme.accentPeriwinkle}>{ensStatus.name}</Text>
          : ensStatus.kind === 'issue'
            ? <Text color={theme.accentError}>{ensStatus.name} ({ensValidationReasonText(ensStatus.reason)})</Text>
            : <Text color={theme.dim}>Not Linked</Text>}
      </Text>
      {tokenLinked ? (
        <Text>
          <Text color={theme.dim}>{'Custody'.padEnd(12)}</Text>
          <Text color={custodyMode ? theme.text : theme.dim}>{displayCustodyMode(custodyMode)}</Text>
        </Text>
      ) : null}
      {ownerAddress ? (
        <Text>
          <Text color={theme.dim}>{'Owner'.padEnd(12)}</Text>
          <Text color={theme.text}>{shortAddress(ownerAddress)}</Text>
        </Text>
      ) : null}
      {(() => {
        if (custodyMode !== 'advanced') return null
        const vaultAddress = readIdentityStateString(identity.state, 'operatorVaultAddress')
        if (!vaultAddress) return null
        return (
          <Text>
            <Text color={theme.dim}>{'OperatorVault'.padEnd(12)}</Text>
            <Text color={theme.text}>{shortAddress(vaultAddress)}</Text>
          </Text>
        )
      })()}
      {tokenLinked && custodyMode === 'advanced' ? (
        <Text>
          <Text color={theme.dim}>{'Operators'.padEnd(12)}</Text>
          {approvedOperatorCount > 1 ? (
            <Text color={theme.text}>{`${approvedOperatorCount} authorized${activeOperator ? ` (active ${shortAddress(activeOperator)})` : ''}`}</Text>
          ) : activeOperator ? (
            <Text color={theme.text}>{shortAddress(activeOperator)}</Text>
          ) : (
            <Text color={theme.dim}>None Authorized</Text>
          )}
        </Text>
      ) : null}
      <Text>
        <Text color={theme.dim}>{'Last Saved'.padEnd(12)}</Text>
        <Text color={lastBackup === 'never' ? theme.dim : theme.text}>{displayValue(lastBackup)}</Text>
      </Text>
      {hasPendingPublish(identity) ? (
        <Text>
          <Text color={theme.dim}>{'Pending'.padEnd(12)}</Text>
          <Text color={theme.dim}>local snapshot ahead of chain, owner wallet rotates the pointer</Text>
        </Text>
      ) : null}
      {transferSnapshot ? (
        <Box marginTop={1}>
          <TransferSnapshotStatus status={transferSnapshot} />
        </Box>
      ) : null}
      {!hideLocalChanges && (
        <Box marginTop={1}>
          <LocalChangeStatusLine status={localChangeStatus} />
        </Box>
      )}
    </Box>
  )
}

const TransferSnapshotStatus: React.FC<{ status: NonNullable<TransferSnapshotView> }> = ({ status }) => {
  const receiverLabel = status.receiverHandle && status.receiverHandle !== status.receiver
    ? `${shortAddress(status.receiver)} (${status.receiverHandle})`
    : shortAddress(status.receiver)
  const title = status.kind === 'ready-to-transfer'
    ? 'Transfer snapshot ready'
    : 'Transfer snapshot received'
  const detail = status.kind === 'ready-to-transfer'
    ? 'sender can transfer externally'
    : 'receiver can restore from this snapshot'
  return (
    <Box flexDirection="column">
      <Text color={theme.accentPeriwinkle} bold>{title}</Text>
      <Text>
        <Text color={theme.dim}>{'Sender'.padEnd(12)}</Text>
        <Text color={theme.text}>{shortAddress(status.sender)}</Text>
      </Text>
      <Text>
        <Text color={theme.dim}>{'Receiver'.padEnd(12)}</Text>
        <Text color={theme.text}>{receiverLabel}</Text>
      </Text>
      <Text color={theme.textSubtle}>{status.slotCount} decrypt slots · {detail}</Text>
    </Box>
  )
}

const LocalChangeStatusLine: React.FC<{ status: LocalChangeStatusView }> = ({ status }) => {
  if (status.hasLocalChanges) {
    return (
      <Text color={theme.accentError} bold>
        Local changes detected
        {status.files.length > 0 ? `: ${status.files.join(', ')}` : ''}
      </Text>
    )
  }

  if (!status.detail) return null

  const color = status.tone === 'ok' || status.tone === 'warn' ? theme.accentPeriwinkle : theme.dim
  const label = status.detail === 'None detected' ? 'No local changes detected' : status.detail
  return <Text color={color}>{label}</Text>
}

function displayValue(value: string): string {
  const mapped = DISPLAY_VALUES[value]
  return mapped ?? value
}

const DISPLAY_VALUES: Record<string, string> = {
  'not attached': 'Not Attached',
  'not connected': 'Not Connected',
  'not created': 'Not Created',
  'not saved': 'Not Saved',
  'not saved yet': 'Not Saved Yet',
  'never': 'Never',
  'unknown': 'Unknown',
  'ethereum mainnet': 'Ethereum Mainnet',
  'base': 'Base',
}
