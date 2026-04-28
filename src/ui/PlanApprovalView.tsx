import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from './Surface.js'
import { theme } from './theme.js'
import { useAppInput } from '../input/AppInputProvider.js'

export type PlanApprovalAction = 'apply' | 'apply-summary' | 'continue'

type PlanApprovalViewProps = {
  contextLabel: string
  onSelect: (action: PlanApprovalAction) => void
  onCancel: () => void
}

export const PLAN_APPROVAL_OPTIONS: Array<{
  value: PlanApprovalAction
  label: string
  title: string
  detail: (contextLabel: string) => string
}> = [
  {
    value: 'apply',
    label: 'Yes, implement this plan',
    title: 'Switch to Accept Edits and start coding.',
    detail: contextLabel => `Same conversation. ${contextLabel}.`,
  },
  {
    value: 'apply-summary',
    label: 'Yes, start a new conversation',
    title: 'Summarize context and start coding.',
    detail: () => 'Keeps this conversation active and carries summary plus plan.',
  },
  {
    value: 'continue',
    label: 'No, stay in Plan mode',
    title: 'Continue planning with the model.',
    detail: () => 'No files will be changed.',
  },
]

export const PlanApprovalView: React.FC<PlanApprovalViewProps> = ({
  contextLabel,
  onSelect,
  onCancel,
}) => {
  const [index, setIndex] = useState(0)
  const selected = PLAN_APPROVAL_OPTIONS[index] ?? PLAN_APPROVAL_OPTIONS[0]!

  useAppInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setIndex(current => (current - 1 + PLAN_APPROVAL_OPTIONS.length) % PLAN_APPROVAL_OPTIONS.length)
    } else if (key.downArrow || input === 'j') {
      setIndex(current => (current + 1) % PLAN_APPROVAL_OPTIONS.length)
    } else if (key.return) {
      onSelect(selected.value)
    } else if (key.escape) {
      onCancel()
    }
  })

  return (
    <Surface
      title="Implement this plan?"
      tone="muted"
      footer="Press enter to confirm or esc to go back"
    >
      <Box flexDirection="row">
        <Box flexDirection="column" minWidth={36}>
          {PLAN_APPROVAL_OPTIONS.map((option, optionIndex) => {
            const active = optionIndex === index
            return (
              <Box key={option.value} flexDirection="row">
                <Text color={active ? theme.accentMint : theme.dim}>
                  {active ? '> ' : '  '}
                  {optionIndex + 1}.{' '}
                </Text>
                <Text color={active ? theme.accentMint : theme.text} bold={active}>
                  {option.label}
                </Text>
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="column" marginLeft={4} flexShrink={1}>
          <Text color={theme.accentMint} bold>{selected.title}</Text>
          <Text color={theme.dim}>{selected.detail(contextLabel)}</Text>
        </Box>
      </Box>
    </Surface>
  )
}
