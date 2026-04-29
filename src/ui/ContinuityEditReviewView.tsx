import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from './Surface.js'
import { Select } from './Select.js'
import { theme } from './theme.js'

export type ContinuityEditReviewState = {
  file: 'SOUL.md' | 'MEMORY.md'
  filePath: string
  summary: string
}

export type ContinuityEditReviewAction = 'open' | 'save-publish' | 'later'

export const ContinuityEditReviewView: React.FC<{
  review: ContinuityEditReviewState
  onSelect: (action: ContinuityEditReviewAction) => void | Promise<void>
  onCancel: () => void
}> = ({ review, onSelect, onCancel }) => (
  <Surface
    title="Private Markdown Updated"
    subtitle="Review the file, then save an encrypted snapshot when ready."
    footer="enter select - esc later"
  >
    <Box flexDirection="column">
      <Text color={theme.accentMint}>{review.summary}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.textSubtle}>review file</Text>
        <Text color={theme.text}>{review.filePath}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.textSubtle}>saved locally</Text>
        <Text color={theme.dim}>The previous version is in private identity history. /rewind does not restore identity markdown.</Text>
      </Box>
    </Box>
    <Box marginTop={1}>
      <Select<ContinuityEditReviewAction>
        options={[
          { value: 'open', label: `open ${review.file}`, hint: 'review the edited markdown file now' },
          { value: 'save-publish', label: 'save snapshot and publish', hint: 'opens Agent Settings; choose that publishing action' },
          { value: 'later', label: 'later', hint: 'use Alt+I -> memory, persona, skills when ready' },
        ]}
        onSubmit={onSelect}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
