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
    title="Private Continuity Updated"
    subtitle="Review the file, then save an encrypted snapshot."
    footer="enter select · esc later"
  >
    <Box flexDirection="column">
      <Text color={theme.accentMint}>{review.summary}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.textSubtle}>review file</Text>
        <Text color={theme.text}>{review.filePath}</Text>
      </Box>
      {review.editorOpened && (
        <Box marginTop={1}>
          <Text color={theme.accentPeach}>Save with ctrl+s in your editor</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.textSubtle}>saved locally</Text>
        <Text color={theme.dim}>Previous version saved in identity history. /rewind does not restore identity continuity.</Text>
      </Box>
    </Box>
    <Box marginTop={1}>
      <Select<ContinuityEditReviewAction>
        options={[
          { value: 'open', label: `open ${review.file}`, hint: 'review the edited private file now' },
          { value: 'save-publish', label: 'save snapshot now', hint: 'go directly to wallet approval' },
          { value: 'later', label: 'later', hint: 'keep the local draft unsaved' },
        ]}
        onSubmit={onSelect}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
