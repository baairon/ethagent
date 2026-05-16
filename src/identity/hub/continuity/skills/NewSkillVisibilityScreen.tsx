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
    subtitle="Public is the default. You can change it later from Change Visibility."
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
          { value: 'private', label: 'Private', hint: 'Local-only. Not in skills.json.' },
          { value: 'public', label: 'Public', hint: 'Default. Indexed in skills.json and Agent Card.' },
          { value: 'back', role: 'section', label: 'Navigation' },
          { value: 'back', label: 'Back', hint: 'Return to the name step', role: 'utility' },
        ]}
        hintLayout="inline"
        initialIndex={1}
        onSubmit={choice => {
          if (choice === 'back') return onCancel()
          return onSelect(choice)
        }}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
