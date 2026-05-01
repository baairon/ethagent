import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { identitySummaryRows, lastBackupLabel } from '../identityHubModel.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

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
  
  const needsBackup = workingStatus?.publishState === 'local-changes' || workingStatus?.publishState === 'not-published' || workingStatus?.publishState === 'verify-needed'
  let changedFiles: string[] = []
  if (needsBackup) {
    if (workingStatus?.localContentHashes && workingStatus?.publishedContentHashes) {
      if (workingStatus.localContentHashes['SOUL.md'] !== workingStatus.publishedContentHashes['SOUL.md']) changedFiles.push('SOUL.md')
      if (workingStatus.localContentHashes['MEMORY.md'] !== workingStatus.publishedContentHashes['MEMORY.md']) changedFiles.push('MEMORY.md')
      if (workingStatus.localContentHashes['skills.json'] !== workingStatus.publishedContentHashes['skills.json']) changedFiles.push('skills.json')
    } else {
      changedFiles = ['SOUL.md', 'MEMORY.md', 'skills.json']
    }
  }

  const lastSavedRow = needsBackup
    ? { label: 'Unsaved', value: changedFiles.length > 0 ? changedFiles.join(', ') : 'Markdown files', tone: 'warn' as const, highlight: true }
    : { label: 'Last Saved', value: lastBackup, tone: lastBackup === 'never' ? 'dim' as const : 'ok' as const }

  const summaryRows = [
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
        const valueColor = row.tone === 'warn' ? 'red' : (row.tone === 'ok' ? theme.text : theme.dim)
        return (
          <Text key={row.label}>
            <Text color={theme.dim}>{row.label.padEnd(12)}</Text>
            <Text color={valueColor} bold={row.highlight}>{displayValue(row.value)}</Text>
          </Text>
        )
      })}
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
  'arbitrum one': 'Arbitrum One',
  'base': 'Base',
  'optimism': 'Optimism',
  'polygon': 'Polygon',
}
