import React from 'react'
import { Box, Text, useApp } from 'ink'
import { Surface } from '../ui/Surface.js'
import { Select } from '../ui/Select.js'
import { theme } from '../ui/theme.js'
import { TerminalSizeProvider, useContentWidth } from '../ui/layout.js'
import { wrapWords } from '../ui/text.js'
import { Logo } from '../identity/manager/shared/components/Logo.js'
import type { ResetPlan } from '../storage/reset.js'

export const ResetConfirmView: React.FC<{
  plan: ResetPlan
  onDone: (confirmed: boolean) => void
}> = ({ plan, onDone }) => {
  const { exit } = useApp()

  const finish = (confirmed: boolean) => {
    onDone(confirmed)
    exit()
  }

  return (
    <TerminalSizeProvider>
      <Box flexDirection="column" alignItems="center" width="100%" marginTop={1}>
        <Logo />
        <Box flexDirection="column" marginTop={1} width="100%">
          <Surface
            title="Reset ethagent?"
            subtitle="This only clears the current machine."
            footer="↵ select · esc cancel"
            tone="error"
          >
            <Section title="Deletes" color={theme.accentError} lines={[
              plan.configDir,
              'Soul, memory, skills, and config',
              'The ethagent blocks in your tools\' instruction files',
            ]} />
            <Section title="Keeps" color={theme.dim} lines={[
              'Your ERC-8004 token and ENS name',
              'Snapshots already pinned on IPFS',
              'Your saved Pinata JWT',
            ]} />
            <Select<'confirm' | 'cancel'>
              options={[
                { value: 'confirm', label: 'Reset Everything', hint: 'Clears local data', bold: true },
                { value: 'cancel', label: 'Cancel', hint: 'Leave everything as is' },
              ]}
              hintLayout="inline"
              initialIndex={1}
              onSubmit={choice => finish(choice === 'confirm')}
              onCancel={() => finish(false)}
            />
          </Surface>
        </Box>
      </Box>
    </TerminalSizeProvider>
  )
}

const Section: React.FC<{ title: string; color: string; lines: string[] }> = ({ title, color, lines }) => {
  const contentWidth = useContentWidth()
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>{title}</Text>
      {lines.map((line, i) => (
        <Box key={i} flexDirection="row">
          <Text color={theme.textSubtle}>· </Text>
          <Text color={theme.textSubtle}>{wrapWords(line, contentWidth - 2).join('\n')}</Text>
        </Box>
      ))}
    </Box>
  )
}
