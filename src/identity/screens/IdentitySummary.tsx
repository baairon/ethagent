import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { identitySummaryRows, lastBackupLabel } from '../identityHubModel.js'

export const IdentitySummary: React.FC<{
  identity?: EthagentIdentity
  config?: EthagentConfig
  compact?: boolean
}> = ({ identity, config, compact = false }) => {
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

  if (compact) {
    const row = (label: string) => rows.find(item => item.label === label)
    return (
      <Box flexDirection="column">
        <Text>
          {stateName ? <Text color={theme.accentPrimary} bold>{stateName}</Text> : <Text color={theme.accentPrimary} bold>agent</Text>}
          <Text color={theme.dim}>  </Text>
          <Text color={theme.text} bold>{row('token')?.value ?? 'not created'}</Text>
          <Text color={theme.dim}>  </Text>
          <Text color={theme.text}>{row('network')?.value ?? 'unknown'}</Text>
        </Text>
        <Text>
          <Text color={theme.dim}>owner </Text>
          <Text color={theme.text}>{row('owner')?.value ?? 'not connected'}</Text>
          <Text color={theme.dim}>  backup </Text>
          <Text color={lastBackup === 'never' ? theme.dim : theme.text}>{lastBackup}</Text>
        </Text>
        <Text>
          <Text color={theme.dim}>state </Text>
          <Text color={row('state')?.tone === 'ok' ? theme.text : theme.dim}>{row('state')?.value ?? 'not saved yet'}</Text>
          <Text color={theme.dim}>  skills </Text>
          <Text color={row('skills')?.tone === 'ok' ? theme.text : theme.dim}>{row('skills')?.value ?? 'not published'}</Text>
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {stateName ? <Text color={theme.accentPrimary} bold>{stateName}</Text> : null}
      {rows.map(row => {
        const valueColor = row.tone === 'ok' ? theme.text : theme.dim
        const isHighlight = row.label === 'token' || row.label === 'state'
        return (
          <Text key={row.label}>
            <Text color={theme.dim}>{row.label.padEnd(8)}</Text>
            <Text color={valueColor} bold={isHighlight}>{row.value}</Text>
          </Text>
        )
      })}
      <Text>
        <Text color={theme.dim}>{'backup'.padEnd(8)}</Text>
        <Text color={lastBackup === 'never' ? theme.dim : theme.text}>{lastBackup}</Text>
      </Text>
    </Box>
  )
}
