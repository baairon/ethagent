import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { identitySummaryRows, lastBackupLabel } from '../identityHubModel.js'

export const IdentitySummary: React.FC<{
  identity?: EthagentIdentity
  config?: EthagentConfig
}> = ({ identity, config }) => {
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
