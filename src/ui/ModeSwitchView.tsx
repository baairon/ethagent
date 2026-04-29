import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from './Surface.js'
import { Select, type SelectOption } from './Select.js'
import { theme } from './theme.js'
import type { SessionMode } from '../runtime/sessionMode.js'

type ModeSwitchViewProps = {
  currentMode: SessionMode
  onSelect: (mode: SessionMode) => void
  onCancel: () => void
}

export const ModeSwitchView: React.FC<ModeSwitchViewProps> = ({ currentMode, onSelect, onCancel }) => {
  const options = buildOptions(currentMode)
  const initialIndex = Math.max(0, options.findIndex(option => option.value !== currentMode))

  return (
    <Surface
      title="Session Mode"
      subtitle="Choose how the agent should behave for the next turns."
      footer="enter switches mode - esc closes"
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim}>Current mode: {labelForMode(currentMode)}</Text>
      </Box>
      <Select options={options} initialIndex={initialIndex} onSubmit={onSelect} onCancel={onCancel} />
    </Surface>
  )
}

function buildOptions(currentMode: SessionMode): Array<SelectOption<SessionMode>> {
  return [
    {
      value: 'chat',
      label: 'Default Chat',
      hint: currentMode === 'chat' ? 'current - normal prompting with permission prompts' : 'normal prompting with permission prompts',
    },
    {
      value: 'plan',
      label: 'Plan Mode',
      hint: currentMode === 'plan' ? 'current - inspection only, no mutating tools' : 'inspection only, no mutating tools',
    },
    {
      value: 'accept-edits',
      label: 'Accept Edits',
      hint: currentMode === 'accept-edits'
        ? 'current - workspace edits auto-allow, private continuity prompts'
        : 'workspace edits auto-allow, private continuity prompts',
    },
  ]
}

function labelForMode(mode: SessionMode): string {
  return mode === 'plan' ? 'plan mode' : mode === 'accept-edits' ? 'accept edits' : 'default chat'
}
