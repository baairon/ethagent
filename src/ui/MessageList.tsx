import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { ProgressBar } from './ProgressBar.js'

export type MessageRow =
  | { role: 'user'; id: string; content: string }
  | { role: 'assistant'; id: string; content: string; streaming?: boolean }
  | { role: 'thinking'; id: string; content: string; streaming?: boolean }
  | { role: 'note'; id: string; kind: 'info' | 'error' | 'dim'; content: string }
  | {
      role: 'progress'
      id: string
      title: string
      progress: number
      status: string
      suffix?: string
      done?: boolean
    }

type MessageListProps = {
  rows: MessageRow[]
}

export const MessageList: React.FC<MessageListProps> = ({ rows }) => {
  return (
    <Box flexDirection="column">
      {rows.map(row => <RowView key={row.id} row={row} />)}
    </Box>
  )
}

const RowView: React.FC<{ row: MessageRow }> = ({ row }) => {
  if (row.role === 'user') {
    const lines = row.content.length === 0 ? [''] : row.content.split('\n')
    return (
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, i) => (
          <Text key={i}>
            {i === 0 ? (
              <Text color={theme.accentMint}>{'\u203a '}</Text>
            ) : (
              <Text color={theme.dim}>{'  '}</Text>
            )}
            <Text color={theme.textSubtle}>{line}</Text>
          </Text>
        ))}
      </Box>
    )
  }

  if (row.role === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.text}>
          {row.content || (row.streaming ? ' ' : '')}
          {row.streaming ? <Text color={theme.accentMint}> ▌</Text> : null}
        </Text>
      </Box>
    )
  }

  if (row.role === 'thinking') {
    const chars = row.content.length
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.dim}>▸ reasoning ({chars} char{chars === 1 ? '' : 's'}){row.streaming ? ' …' : ''}</Text>
      </Box>
    )
  }

  if (row.role === 'note') {
    const color = row.kind === 'error' ? '#e87070' : row.kind === 'dim' ? theme.dim : theme.accentInfo
    return (
      <Box marginTop={1}>
        <Text color={color}>{row.content}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.accentMint} bold>{row.title}</Text>
      <Text color={theme.dim}>{row.status}</Text>
      <ProgressBar progress={row.progress} suffix={row.suffix} />
    </Box>
  )
}

export default MessageList
