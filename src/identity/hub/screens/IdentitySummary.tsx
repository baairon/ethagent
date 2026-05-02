import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import {
  identitySummaryRows,
  lastBackupLabel,
  localChangeStatusView,
  type LocalChangeStatusView,
} from '../identityHubModel.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

type SummaryRow = {
  label: string
  value: string
  tone: 'ok' | 'dim' | 'warn'
  highlight?: boolean
}

export const IdentitySummary: React.FC<{
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  compact?: boolean
}> = ({ identity, config, workingStatus, compact = false }) => {
  if (!identity) {
    return (
      <Text color={theme.dim}>No agent yet. Create or load one.</Text>
    )
  }

  const rows = identitySummaryRows(identity, config)
  const lastBackup = lastBackupLabel(identity)
  const stateName = typeof (identity.state as Record<string, unknown> | undefined)?.name === 'string'
    ? ((identity.state as Record<string, unknown>).name as string).trim()
    : ''

  const row = (label: string) => rows.find(item => item.label === label)
  const localChangeStatus = localChangeStatusView(workingStatus)
  const lastSavedRow: SummaryRow = { label: 'Last Saved', value: lastBackup, tone: lastBackup === 'never' ? 'dim' : 'ok' }

  const summaryRows: SummaryRow[] = [
    { label: 'Token', value: row('token')?.value ?? 'Not Created', tone: row('token')?.tone ?? 'dim', highlight: true },
    { label: 'Network', value: row('network')?.value ?? 'Unknown', tone: row('network')?.tone ?? 'dim' },
    { label: 'Owner', value: row('owner')?.value ?? 'Not Connected', tone: row('owner')?.tone ?? 'dim' },
    { label: 'Snapshot', value: row('state')?.value ?? 'Not Saved Yet', tone: row('state')?.tone ?? 'dim', highlight: true },
    lastSavedRow,
    { label: 'Skills', value: row('skills')?.value ?? 'Not Saved', tone: row('skills')?.tone ?? 'dim' },
    { label: 'Agent Card', value: row('card')?.value ?? 'Not Saved', tone: row('card')?.tone ?? 'dim' },
    { label: 'Image', value: row('image')?.value ?? 'Not Attached', tone: row('image')?.tone ?? 'dim' },
  ]

  return (
    <Box flexDirection="column">
      <Text color={theme.accentPrimary} bold>{stateName || 'Active Agent'}</Text>
      {summaryRows.map(row => {
        const valueColor = row.tone === 'warn' ? '#e87070' : (row.tone === 'ok' ? theme.text : theme.dim)
        return (
          <Text key={row.label}>
            <Text color={theme.dim}>{row.label.padEnd(12)}</Text>
            <Text color={valueColor} bold={row.highlight ?? false}>{displayValue(row.value)}</Text>
          </Text>
        )
      })}
      <Box marginTop={1}>
        <LocalChangeStatusLine status={localChangeStatus} />
      </Box>
    </Box>
  )
}

const LocalChangeStatusLine: React.FC<{ status: LocalChangeStatusView }> = ({ status }) => {
  if (status.hasLocalChanges) {
    return (
      <Text color="#e87070" bold>
        Local changes detected
        {status.files.length > 0 ? `: ${status.files.join(', ')}` : ''}
      </Text>
    )
  }

  const color = status.tone === 'ok' ? theme.accentMint : status.tone === 'warn' ? theme.accentPeach : theme.dim
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
  'arbitrum one': 'Arbitrum One',
  'base': 'Base',
  'optimism': 'Optimism',
  'polygon': 'Polygon',
}
