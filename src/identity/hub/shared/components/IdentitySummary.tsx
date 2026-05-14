import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import {
  displayCustodyMode,
  identityOwnerAddress,
  readCustodyMode,
  readIdentityStateString,
} from '../../custody/state.js'
import {
  hasPendingPublish,
  localChangeStatusView,
  type LocalChangeStatusView,
} from '../../continuity/state.js'
import { ensValidationReasonText, selectEnsStatus } from '../../ens/state.js'
import { shortAddress } from '../model/format.js'
import { identitySummaryRows, lastBackupLabel } from '../../profile/identity.js'
import { transferSnapshotView, type TransferSnapshotView } from '../../transfer/state.js'

import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'

interface IdentitySummaryProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  hideLocalChanges?: boolean
  hideHeader?: boolean
  tokenLinked?: boolean
  onchainOwner?: string
}

export const IdentitySummary: React.FC<IdentitySummaryProps> = ({ identity, config, workingStatus, hideLocalChanges = false, hideHeader = false, tokenLinked = true, onchainOwner }) => {
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
      {hideHeader ? null : (
        <>
          <Text color={theme.accentPeriwinkle} bold>{stateName || 'Active Agent'}</Text>
          <Text color={identity.agentId ? theme.text : theme.dim} bold={Boolean(identity.agentId)}>{tokenLine}</Text>
        </>
      )}
      <SummaryRow
        left={{
          label: 'ENS',
          value: ensStatus.kind === 'linked'
            ? <Text color={theme.accentPeriwinkle}>{ensStatus.name}</Text>
            : ensStatus.kind === 'issue'
              ? <Text color={theme.accentError}>{ensStatus.name} ({ensValidationReasonText(ensStatus.reason)})</Text>
              : <Text color={theme.dim}>Not Linked</Text>,
        }}
        right={tokenLinked
          ? {
              label: 'Custody',
              value: <Text color={custodyMode ? theme.text : theme.dim}>{displayCustodyMode(custodyMode)}</Text>,
            }
          : undefined}
      />
      {(() => {
        const vaultAddress = custodyMode === 'advanced'
          ? readIdentityStateString(identity.state, 'operatorVaultAddress')
          : undefined
        const pairedOperatorsValue = custodyMode === 'advanced' && tokenLinked
          ? approvedOperatorCount > 1
            ? <Text color={theme.text}>{`${approvedOperatorCount} authorized`}</Text>
            : activeOperator
              ? <Text color={theme.text}>{shortAddress(activeOperator)}</Text>
              : <Text color={theme.dim}>None Authorized</Text>
          : null
        const lastSavedCell = {
          label: 'Last Saved',
          value: <Text color={lastBackup === 'never' ? theme.dim : theme.text}>{displayValue(lastBackup)}</Text>,
        }
        const pendingCell = {
          label: 'Pending',
          value: <Text color={theme.dim}>local ahead of chain, owner rotates pointer</Text>,
        }
        return (
          <>
            {ownerAddress ? (
              <SummaryRow
                left={{
                  label: 'Owner',
                  value: <Text color={theme.text}>{shortAddress(ownerAddress)}</Text>,
                }}
                {...(pairedOperatorsValue
                  ? { right: { label: 'Operators', value: pairedOperatorsValue } }
                  : {})}
              />
            ) : null}
            {vaultAddress ? (
              <SummaryRow
                left={{ label: 'Vault', value: <Text color={theme.text}>{shortAddress(vaultAddress)}</Text> }}
                right={hasPendingPublish(identity) ? pendingCell : lastSavedCell}
              />
            ) : (
              hasPendingPublish(identity)
                ? <SummaryRow left={lastSavedCell} right={pendingCell} />
                : <SummaryRow left={lastSavedCell} />
            )}
          </>
        )
      })()}
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

type SummaryCell = { label: string; value: React.ReactNode }

const LEFT_LABEL_WIDTH = 12
const LEFT_VALUE_WIDTH = 30
const RIGHT_CELL_WIDTH = 36

const SummaryRow: React.FC<{ left: SummaryCell; right?: SummaryCell }> = ({ left, right }) => {
  if (!right) {
    return (
      <Text>
        <Text color={theme.dim}>{left.label.padEnd(LEFT_LABEL_WIDTH)}</Text>
        {left.value}
      </Text>
    )
  }
  return (
    <Box flexDirection="row">
      <Box width={LEFT_LABEL_WIDTH + LEFT_VALUE_WIDTH}>
        <Text>
          <Text color={theme.dim}>{left.label.padEnd(LEFT_LABEL_WIDTH)}</Text>
          {left.value}
        </Text>
      </Box>
      <Box width={RIGHT_CELL_WIDTH}>
        <Text>
          <Text color={theme.dim}>{right.label.padEnd(LEFT_LABEL_WIDTH)}</Text>
          {right.value}
        </Text>
      </Box>
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
      <Box flexDirection="column">
        <Text color={theme.accentError} bold>
          Local changes detected
          {status.files.length > 0 ? `: ${status.files.join(', ')}` : ''}
        </Text>
        <Text color={theme.dim}>Save Snapshot Now to publish.</Text>
      </Box>
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
