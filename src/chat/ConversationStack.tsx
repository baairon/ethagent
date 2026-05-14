import React from 'react'
import { Box, Static } from 'ink'
import { TranscriptView } from './transcript/TranscriptView.js'
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
  onTranscriptScrollabilityChange?: (canScroll: boolean) => void
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
  onTranscriptScrollabilityChange,
}) => {
  return (
    <>
      {header ? (
        <Static items={[{ id: `header-${sessionKey}`, node: header }]}>
          {item => <Box key={item.id} paddingX={1} paddingTop={1}>{item.node}</Box>}
        </Static>
      ) : null}
      <Box flexDirection="column" padding={1}>
        <TranscriptView
          key={`transcript-${sessionKey}`}
          rows={rows}
          active={transcriptActive}
          bottomVariant={bottomVariant}
          onVisibleReasoningIdsChange={onVisibleReasoningIdsChange}
          onScrollabilityChange={onTranscriptScrollabilityChange}
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
    </>
  )
}
