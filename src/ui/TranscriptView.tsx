import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { MessageList, type MessageRow } from './MessageList.js'
import { estimateMessageRowHeight, selectTailRowsForViewport } from './transcriptViewport.js'
import { theme } from './theme.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({
  rows,
  active = true,
  bottomVariant = 'prompt',
}) => {
  void active
  const { stdout } = useStdout()
  const terminalRows = stdout.rows ?? process.stdout.rows ?? 24
  const terminalColumns = stdout.columns ?? process.stdout.columns ?? 80
  const reservedRows = bottomVariant === 'prompt' ? 11 : 7
  const lineBudget = Math.max(16, Math.min(96, terminalRows - reservedRows + 24))
  const visible = selectTailRowsForViewport(
    rows,
    lineBudget,
    row => estimateMessageRowHeight(row, terminalColumns),
  )

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text> </Text>
      </Box>
      {visible.hiddenCount > 0 ? (
        <Text color={theme.dim}>{`... ${visible.hiddenCount} earlier transcript row${visible.hiddenCount === 1 ? '' : 's'} hidden`}</Text>
      ) : null}
      <MessageList rows={visible.rows} />
    </Box>
  )
}
