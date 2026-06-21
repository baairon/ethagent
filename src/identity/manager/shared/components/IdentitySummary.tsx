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
import { hasPendingPublish } from '../../continuity/state.js'
import { ensValidationReasonText, selectEnsStatus } from '../../ens/state.js'
import { shortAddress } from '../model/format.js'
import { identitySummaryRows, lastBackupLabel } from '../../profile/identity.js'
import { transferSnapshotView, type TransferSnapshotView } from '../../transfer/state.js'

import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'

interface IdentitySummaryProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  hideHeader?: boolean
  tokenLinked?: boolean
  onchainOwner?: string
  compact?: boolean
}

export const IdentitySummary: React.FC<IdentitySummaryProps> = ({ identity, config, hideHeader = false, tokenLinked = true, onchainOwner, compact = false }) => {
  if (!identity) {
    return (
      <Text color={theme.dim}>No agent yet. Create or load one.</Text>
    )
  }

  const rows = identitySummaryRows(identity, config)
  const lastBackup = lastBackupLabel(identity)
  const stateName = readIdentityStateString(identity.state, 'name')

  const row = (label: string) => rows.find(item => item.label === label)

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

  if (compact) {
    const rawName = stateName || 'Active Agent'
    const name = rawName.length > 16 ? `${rawName.slice(0, 15)}…` : rawName
    const tokenSegment = identity.agentId ? `#${identity.agentId}` : null
    const networkSegment = identity.agentId ? networkValue : null
    const ensSegment = ensStatus.kind === 'linked'
      ? ensStatus.name === rawName ? null : ensStatus.name
      : ensStatus.kind === 'issue'
        ? ensStatus.name
        : null
    return (
      <Text>
        <Text color={theme.textSubtle}>{name}</Text>
        {tokenSegment ? <><Text color={theme.dim}> · </Text><Text color={theme.dim}>{tokenSegment}</Text></> : null}
        {networkSegment ? <><Text color={theme.dim}> · </Text><Text color={theme.dim}>{networkSegment}</Text></> : null}
        {ensSegment ? <><Text color={theme.dim}> · </Text><Text color={ensStatus.kind === 'issue' ? theme.accentError : theme.accentPeriwinkle}>{ensSegment}</Text></> : null}
      </Text>
    )
  }

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
          value: <Text color={theme.dim}>local ahead of onchain, owner rotates pointer</Text>,
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
    </Box>
  )
}

type SummaryCell = { label: string; value: React.ReactNode }

const LEFT_LABEL_WIDTH = 12

const SummaryCellLine: React.FC<{ cell: SummaryCell }> = ({ cell }) => (
  <Text>
    <Text color={theme.dim}>{cell.label.padEnd(LEFT_LABEL_WIDTH)}</Text>
    {cell.value}
  </Text>
)

const SummaryRow: React.FC<{ left: SummaryCell; right?: SummaryCell }> = ({ left, right }) => {
  if (!right) {
    return <SummaryCellLine cell={left} />
  }
  return (
    <Box flexDirection="column">
      <SummaryCellLine cell={left} />
      <SummaryCellLine cell={right} />
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
