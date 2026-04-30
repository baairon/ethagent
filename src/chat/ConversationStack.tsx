import React from 'react'
import { Box } from 'ink'
import { TranscriptView } from './TranscriptView.js'
import type { MessageRow } from './MessageList.js'

type ConversationStackProps = {
  header: React.ReactNode
  rows: MessageRow[]
  transcriptActive?: boolean
  bottomVariant?: 'prompt' | 'overlay'
  bottom: React.ReactNode
  status?: React.ReactNode
  sessionKey: number
  onVisibleReasoningIdsChange?: (ids: string[]) => void
}

export const ConversationStack: React.FC<ConversationStackProps> = ({
  header,
  rows,
  transcriptActive = true,
  bottomVariant = 'prompt',
  bottom,
  status,
  sessionKey,
  onVisibleReasoningIdsChange,
}) => {
  return (
    <Box flexDirection="column" padding={1}>
      {header}
      <TranscriptView
        key={`transcript-${sessionKey}`}
        rows={rows}
        active={transcriptActive}
        bottomVariant={bottomVariant}
        onVisibleReasoningIdsChange={onVisibleReasoningIdsChange}
      />
      <Box marginTop={1} width="100%">
        {bottom}
      </Box>
      {status ? (
        <Box marginTop={1}>
          {status}
        </Box>
      ) : null}
    </Box>
  )
}
