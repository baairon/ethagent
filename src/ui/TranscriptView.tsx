import React from 'react'
import { Box, Text } from 'ink'
import { MessageList, type MessageRow } from './MessageList.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ rows }) => {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text> </Text>
      </Box>
      <MessageList rows={rows} />
    </Box>
  )
}
