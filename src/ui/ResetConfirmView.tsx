import React from 'react'
import { Box, Text, useApp } from 'ink'
import { Surface } from './Surface.js'
import { Select } from './Select.js'
import { theme } from './theme.js'
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
    <Surface title="reset ethagent?" subtitle="are you sure? this only affects this machine." footer="enter select · esc cancel">
      <Box flexDirection="column">
        <Section title="will delete" lines={[
          localDataLine(plan.deletePaths.length),
          'identity metadata, markdown vaults, sessions, prompt history',
          'rewind history, permissions, credentials',
        ]} />
        <Section title="will keep" lines={[
          'installed local LLM assets',
          ...(plan.preservedPaths.length > 0 ? [`${plan.preservedPaths.length} local model path${plan.preservedPaths.length === 1 ? '' : 's'}`] : ['no local model assets found']),
        ]} />
        <Section title="not touched" lines={[
          'onchain agent tokens',
          'IPFS-pinned snapshots and public metadata',
        ]} />
      </Box>
      <Box marginTop={1}>
        <Select<'confirm' | 'cancel'>
          options={[
            { value: 'confirm', label: 'reset local data', hint: 'delete local ethagent data now' },
            { value: 'cancel', label: 'cancel', hint: 'leave local data unchanged' },
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
    <Text color={theme.accentMint}>{title}</Text>
    {lines.map(line => (
      <Text key={line} color={theme.textSubtle}>- {line}</Text>
    ))}
  </Box>
)

function localDataLine(count: number): string {
  if (count === 0) return 'no local ethagent data found'
  return `${count} local path${count === 1 ? '' : 's'} under ~/.ethagent`
}
