import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { SkillVisibility } from '../../../continuity/skills/types.js'

interface NewSkillVisibilityScreenProps {
  name: string
  error?: string
  footer: React.ReactNode
  onSelect: (visibility: SkillVisibility) => void
  onCancel: () => void
}

export const NewSkillVisibilityScreen: React.FC<NewSkillVisibilityScreenProps> = ({
  name,
  error,
  footer,
  onSelect,
  onCancel,
}) => (
  <Surface
    title={`Visibility · ${name}`}
    subtitle="Private is the default."
    footer={footer}
  >
    {error && (
      <Box marginTop={1}>
        <Text color={theme.accentError}>{error}</Text>
      </Box>
    )}
    <Box marginTop={1}>
      <Select<SkillVisibility | 'back'>
        options={[
          { value: 'private', label: 'Private', hint: 'Not in the Agent Card' },
          { value: 'public', label: 'Public', hint: 'Listed in the Agent Card' },
          { value: 'back', role: 'section', label: 'Navigation' },
          { value: 'back', label: 'Back', role: 'utility' },
        ]}
        hintLayout="inline"
        initialIndex={0}
        onSubmit={choice => {
          if (choice === 'back') return onCancel()
          return onSelect(choice)
        }}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
