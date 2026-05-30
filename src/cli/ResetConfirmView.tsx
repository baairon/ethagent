import React, { useEffect, useState } from 'react'
import { Box, Text, useApp, useStdout } from 'ink'
import { Surface } from '../ui/Surface.js'
import { Select } from '../ui/Select.js'
import { theme } from '../ui/theme.js'
import { Wordmark } from '../identity/manager/shared/components/Wordmark.js'
import type { ResetPlan } from '../storage/reset.js'

export const ResetConfirmView: React.FC<{
  plan: ResetPlan
  onDone: (confirmed: boolean) => void
}> = ({ plan, onDone }) => {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [rows, setRows] = useState<number>(stdout?.rows ?? 24)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows ?? 24)
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])

  const finish = (confirmed: boolean) => {
    onDone(confirmed)
    exit()
  }

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%" minHeight={rows}>
      <Wordmark />
      <Box flexDirection="column" marginTop={1} width="100%">
        <Surface
          title="Reset ethagent?"
          subtitle="This only clears the current machine."
          footer="enter select · esc cancel"
          tone="error"
        >
          <Box flexDirection="column">
            <Section title="Deletes" color={theme.accentError} lines={[
              plan.configDir,
              'soul, memory, skills, and config',
              'your saved Pinata token',
              "ethagent's block in your harness files (CLAUDE.md, AGENTS.md)",
            ]} />
            <Section title="Kept" color={theme.dim} lines={[
              'your ERC-8004 token and ENS name',
              'published snapshots on IPFS',
            ]} />
          </Box>
          <Box marginTop={1}>
            <Select<'confirm' | 'cancel'>
              options={[
                { value: 'confirm', label: 'Reset everything', hint: 'Clears local data', bold: true },
                { value: 'cancel', label: 'Cancel', hint: 'Leave everything as is' },
              ]}
              hintLayout="inline"
              initialIndex={1}
              onSubmit={choice => finish(choice === 'confirm')}
              onCancel={() => finish(false)}
            />
          </Box>
        </Surface>
      </Box>
    </Box>
  )
}

const Section: React.FC<{ title: string; color: string; lines: string[] }> = ({ title, color, lines }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={color}>{title}</Text>
    {lines.map((line, i) => (
      <Text key={i} color={theme.textSubtle}>· {line}</Text>
    ))}
  </Box>
)
