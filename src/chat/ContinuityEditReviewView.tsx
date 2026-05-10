import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../ui/Surface.js'
import { Select } from '../ui/Select.js'
import { theme } from '../ui/theme.js'

export type ContinuityEditReviewState = {
  file: 'SOUL.md' | 'MEMORY.md'
  filePath: string
  summary: string
  editorOpened?: boolean
}

export type ContinuityEditReviewAction = 'open' | 'save-publish' | 'later'

export const ContinuityEditReviewView: React.FC<{
  review: ContinuityEditReviewState
  onSelect: (action: ContinuityEditReviewAction) => void | Promise<void>
  onCancel: () => void
}> = ({ review, onSelect, onCancel }) => (
  <Surface
    title={`${review.file} Updated`}
    footer="enter select · esc dismiss"
  >
    <Text color={theme.accentPeriwinkle}>{displayContinuityReviewText(review.summary)}</Text>
    <Box marginTop={1}>
      <Select<ContinuityEditReviewAction>
        options={[
          { value: 'open', label: `Open ${review.file}`, hint: 'Review in editor' },
          { value: 'save-publish', label: 'Save Snapshot', hint: 'Wallet signature' },
          { value: 'later', label: 'Dismiss', hint: 'Save later from Identity Hub' },
        ]}
        onSubmit={onSelect}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)

function displayContinuityReviewText(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value
}
