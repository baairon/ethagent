import React from 'react'
import { Box, Text, Static } from 'ink'
import { MessageList, type MessageRow } from './MessageList.js'

type TranscriptViewProps = {
  rows: MessageRow[]
  active?: boolean
  bottomVariant?: 'prompt' | 'overlay'
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ rows }) => {
  let lastUserIndex = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.role === 'user') {
      lastUserIndex = i
      break
    }
  }

  const staticRows = lastUserIndex > 0 ? rows.slice(0, lastUserIndex) : []
  const dynamicRows = lastUserIndex > 0 ? rows.slice(lastUserIndex) : rows

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text> </Text>
      </Box>
      <Static items={staticRows}>
        {row => (
          <Box key={row.id} flexDirection="column">
            <MessageList rows={[row]} />
          </Box>
        )}
      </Static>
      <MessageList rows={dynamicRows} />
    </Box>
  )
}
