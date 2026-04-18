import React from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { Select } from './Select.js'
import { parseSegments, type Segment } from '../utils/markdownSegments.js'
import { copyToClipboard, type CopyResult } from '../utils/clipboard.js'

type CopyPickerProps = {
  turnText: string
  turnLabel: string
  onDone: (result: CopyResult, label: string) => void
  onCancel: () => void
}

type Choice = { index: number; segment: Segment | null; label: string }

export const CopyPicker: React.FC<CopyPickerProps> = ({ turnText, turnLabel, onDone, onCancel }) => {
  const segments = parseSegments(turnText)
  const choices: Choice[] = [
    { index: -1, segment: null, label: `all (${turnText.length} chars)` },
    ...segments.map((segment, i) => ({ index: i, segment, label: segment.preview })),
  ]

  const options = choices.map(c => ({
    value: c.index,
    label: c.label,
    hint: c.segment ? (c.segment.kind === 'code' ? 'code block' : undefined) : 'full reply',
  }))

  const handleSubmit = (index: number) => {
    const chosen = choices.find(c => c.index === index)
    const payload = chosen?.segment ? chosen.segment.content : turnText
    const label = chosen?.label ?? 'copy'
    void copyToClipboard(payload).then(result => onDone(result, label))
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.accentSecondary} bold>copy from {turnLabel}</Text>
      <Text color={theme.dim}>arrows to move · enter to copy · esc cancels</Text>
      <Box marginTop={1}>
        <Select<number>
          options={options}
          initialIndex={0}
          onSubmit={handleSubmit}
          onCancel={onCancel}
        />
      </Box>
    </Box>
  )
}

export default CopyPicker
