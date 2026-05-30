import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { theme } from '../../../../ui/theme.js'

interface NewSkillScreenProps {
  error?: string
  footer: React.ReactNode
  onSubmit: (name: string) => void
  onCancel: () => void
}

export const NewSkillScreen: React.FC<NewSkillScreenProps> = ({
  error,
  footer,
  onSubmit,
  onCancel,
}) => (
  <Surface
    title="New Skill"
    subtitle="Folder name. The skill activates by this name."
    footer={footer}
  >
    <Box marginTop={1} flexDirection="column">
      <TextInput
        label="Folder name"
        placeholder="<folder>"
        validate={value => validateSegment(value)}
        onSubmit={raw => {
          const trimmed = raw.trim()
          if (validateSegment(trimmed) === null) onSubmit(trimmed)
        }}
        onCancel={onCancel}
      />
      {error && (
        <Box marginTop={1}>
          <Text color={theme.accentError}>{error}</Text>
        </Box>
      )}
    </Box>
  </Surface>
)

export function validateSegment(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter a name.'
  if (trimmed.includes('/') || trimmed.includes('\\')) return 'One segment only, no slashes.'
  if (trimmed === '.' || trimmed === '..') return 'Reserved name.'
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return 'Only letters, digits, dashes, underscores, dots.'
  return null
}
