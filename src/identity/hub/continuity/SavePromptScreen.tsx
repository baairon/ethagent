import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { changedContinuitySnapshotFiles } from './state.js'

type SavePromptAction = 'save-now' | 'later'

interface SavePromptScreenProps {
  workingStatus?: ContinuityWorkingTreeStatus | null
  footer: React.ReactNode
  onSelect: (action: SavePromptAction) => void
  onCancel: () => void
}

export const SavePromptScreen: React.FC<SavePromptScreenProps> = ({ workingStatus, footer, onSelect, onCancel }) => {
  const files = changedContinuitySnapshotFiles(workingStatus)

  return (
    <Surface
      title="Save your identity changes?"
      subtitle="Unsaved local edits since the last snapshot."
      footer={footer}
      tone="primary"
    >
      <Box flexDirection="column">
        {files.length > 0 ? (
          <Text color={theme.textSubtle}>Changed: <Text color={theme.accentError} bold>{files.join(', ')}</Text></Text>
        ) : (
          <Text color={theme.accentPeriwinkle}>Local files differ from the saved snapshot.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<SavePromptAction>
          options={[
            { value: 'save-now', label: 'Save now', hint: 'Sign once and save the encrypted snapshot' },
            { value: 'later', label: 'Not now', hint: 'Ask again on the next launch', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={onSelect}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}
