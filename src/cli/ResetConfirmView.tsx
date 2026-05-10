import React from 'react'
import { Box, Text, useApp } from 'ink'
import { Surface } from '../ui/Surface.js'
import { Select } from '../ui/Select.js'
import { theme } from '../ui/theme.js'
import type { FactoryResetPlan } from '../storage/factoryReset.js'

export const ResetConfirmView: React.FC<{
  plan: FactoryResetPlan
  onDone: (confirmed: boolean) => void
}> = ({ plan, onDone }) => {
  const { exit } = useApp()
  const finish = (confirmed: boolean) => {
    onDone(confirmed)
    exit()
  }

  return (
    <Surface title="Reset Local Data?" subtitle="Deletes this machine's ethagent data. Models and onchain records stay." footer="enter select · esc cancel">
      <Box flexDirection="column">
        <Section title="Deletes" lines={[
          'Identity files, sessions, history, credentials',
          localDataLine(plan.deletePaths.length),
        ]} />
        <Section title="Keeps" lines={[
          'Local GGUF models and llama.cpp runners',
          ...(plan.preservedPaths.length > 0 ? [`${plan.preservedPaths.length} local model path${plan.preservedPaths.length === 1 ? '' : 's'}`] : ['No local model assets found']),
        ]} />
        <Section title="Not Touched" lines={[
          'ERC-8004 tokens and onchain records',
          'IPFS snapshots and public metadata',
        ]} />
      </Box>
      <Box marginTop={1}>
        <Select<'confirm' | 'cancel'>
          options={[
            { value: 'confirm', label: 'Reset Local Data', hint: 'Delete local ethagent data now' },
            { value: 'cancel', label: 'Cancel', hint: 'Leave local data unchanged' },
          ]}
          onSubmit={choice => finish(choice === 'confirm')}
          onCancel={() => finish(false)}
        />
      </Box>
    </Surface>
  )
}

const Section: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={theme.accentPeriwinkle}>{title}</Text>
    {lines.map(line => (
      <Text key={line} color={theme.textSubtle}>- {line}</Text>
    ))}
  </Box>
)

function localDataLine(count: number): string {
  if (count === 0) return 'No local ethagent data found'
  return `${count} local path${count === 1 ? '' : 's'} under ~/.ethagent`
}
