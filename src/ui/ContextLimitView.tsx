import React, { useState } from 'react'
import { Box, Text } from 'ink'
import type { ContextUsage } from '../runtime/compaction.js'
import { useAppInput } from '../input/AppInputProvider.js'
import { theme } from './theme.js'

export type ContextLimitAction = 'compact' | 'switchModel' | 'send' | 'cancel'

type ContextLimitViewProps = {
  usage: ContextUsage
  promptPreview: string
  onSelect: (action: ContextLimitAction) => void | Promise<void>
  onCancel: () => void
}

export const CONTEXT_LIMIT_OPTIONS: Array<{ action: ContextLimitAction; label: string; detail: string }> = [
  {
    action: 'compact',
    label: 'Summarize and move to new conversation',
    detail: 'Summarize this transcript into a new conversation, then send the pending message.',
  },
  {
    action: 'switchModel',
    label: 'Switch to larger-context model',
    detail: 'Pick a model that can fit this conversation, then send the pending message.',
  },
  {
    action: 'send',
    label: 'Ignore warning and send',
    detail: 'May hit rate/context limits faster or degrade local/cloud model behavior.',
  },
  {
    action: 'cancel',
    label: 'Cancel',
    detail: 'Return to the prompt without sending the pending message.',
  },
]

export const ContextLimitView: React.FC<ContextLimitViewProps> = ({
  usage,
  promptPreview,
  onSelect,
  onCancel,
}) => {
  const [selected, setSelected] = useState(0)

  useAppInput((_input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.upArrow) {
      setSelected(i => Math.max(0, i - 1))
      return
    }
    if (key.downArrow) {
      setSelected(i => Math.min(CONTEXT_LIMIT_OPTIONS.length - 1, i + 1))
      return
    }
    if (key.return) {
      const picked = CONTEXT_LIMIT_OPTIONS[selected]
      if (picked) void onSelect(picked.action)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accentPeach} paddingX={1}>
      <Text color={theme.accentPeach} bold>context limit</Text>
      <Text color={theme.dim}>
        {`Context ${usage.percent}% - ~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.windowTokens)} tokens (${usage.source}).`}
      </Text>
      {usage.percent >= 100 ? (
        <Text color={theme.accentPeach}>
          This transcript is over the selected model's estimated window. You can still send, but summarizing first is safer.
        </Text>
      ) : null}
      <Text color={theme.textSubtle}>{`Pending: ${promptPreview || '(empty)'}`}</Text>
      <Box flexDirection="column" marginTop={1}>
        {CONTEXT_LIMIT_OPTIONS.map((option, index) => (
          <Text key={option.action} color={index === selected ? theme.accentPrimary : theme.dim}>
            {index === selected ? '> ' : '  '}
            {option.label}
            <Text color={theme.dim}>{` - ${option.detail}`}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}
