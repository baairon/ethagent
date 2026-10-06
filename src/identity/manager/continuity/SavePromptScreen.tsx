import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { localChangeItems } from './state.js'
import { ChangeList } from './ChangeList.js'

type SavePromptAction = 'save-now' | 'later'

interface SavePromptScreenProps {
  workingStatus?: ContinuityWorkingTreeStatus | null
  footer: React.ReactNode
  onSelect: (action: SavePromptAction) => void
  onCancel: () => void
}

export const SavePromptScreen: React.FC<SavePromptScreenProps> = ({ workingStatus, footer, onSelect, onCancel }) => {
  const items = localChangeItems(workingStatus)

  return (
    <Surface title="Save Your Changes?" footer={footer} tone="primary">
      {items.length > 0
        ? <ChangeList heading="Not in a snapshot yet" items={items} />
        : <Paragraph color={theme.accentPeriwinkle}>Local files differ from your last snapshot.</Paragraph>}
      <Box marginTop={1}>
        <Select<SavePromptAction>
          options={[
            { value: 'save-now', label: 'Save Now', hint: 'Your wallet approves it' },
            { value: 'later', label: 'Not Now', hint: 'Ask again next launch', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={onSelect}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}
