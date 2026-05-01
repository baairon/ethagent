import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { identitySummaryRows, lastBackupLabel } from '../identityHubModel.js'

import type { ContinuityWorkingTreeStatus } from '../continuity/storage.js'

export const IdentitySummary: React.FC<{
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  compact?: boolean
}> = ({ identity, config, workingStatus, compact = false }) => {
  if (!identity) {
    return (
      <Text color={theme.dim}>no agent yet. create or load one.</Text>
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
    ? { label: 'unsaved', value: changedFiles.length > 0 ? changedFiles.join(', ') : 'markdown files', tone: 'warn' as const, highlight: true }
    : { label: 'last saved', value: lastBackup, tone: lastBackup === 'never' ? 'dim' as const : 'ok' as const }

  const summaryRows = [
    { label: 'token', value: row('token')?.value ?? 'not created', tone: row('token')?.tone ?? 'dim', highlight: true },
    { label: 'network', value: row('network')?.value ?? 'unknown', tone: row('network')?.tone ?? 'dim' },
    { label: 'owner', value: row('owner')?.value ?? 'not connected', tone: row('owner')?.tone ?? 'dim' },
    { label: 'snapshot', value: row('state')?.value ?? 'not saved yet', tone: row('state')?.tone ?? 'dim', highlight: true },
    lastSavedRow,
    { label: 'skills', value: row('skills')?.value ?? 'not published', tone: row('skills')?.tone ?? 'dim' },
    { label: 'agent card', value: row('card')?.value ?? 'not published', tone: row('card')?.tone ?? 'dim' },
    { label: 'image', value: row('image')?.value ?? 'not attached', tone: row('image')?.tone ?? 'dim' },
  ]

  return (
    <Box flexDirection="column">
      <Text color={theme.accentPrimary} bold>{stateName || 'active agent'}</Text>
      {summaryRows.map(row => {
        const valueColor = row.tone === 'warn' ? 'red' : (row.tone === 'ok' ? theme.text : theme.dim)
        return (
          <Text key={row.label}>
            <Text color={theme.dim}>{row.label.padEnd(12)}</Text>
            <Text color={valueColor} bold={row.highlight}>{row.value}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
