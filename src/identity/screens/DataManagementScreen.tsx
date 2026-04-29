import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'

export const LOCAL_DATA_MANAGEMENT_COPY = [
  'Private markdown lives locally in SOUL.md and MEMORY.md, with SKILLS.md as public metadata.',
  'Save snapshot and publish encrypts private markdown, pins it to IPFS, and refreshes public discovery metadata.',
  'Unlink active agent only removes the selected agent from this device; markdown, chats, tokens, and IPFS pins stay.',
  'ethagent reset wipes local identity metadata, markdown vaults, sessions, prompt history, rewind history, permissions, and stored credentials.',
  'ethagent reset preserves installed local LLM assets and does not delete onchain tokens or IPFS-pinned snapshots.',
] as const

type DataManagementScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  footer: React.ReactNode
  onBack: () => void
}

export const DataManagementScreen: React.FC<DataManagementScreenProps> = ({
  identity,
  config,
  footer,
  onBack,
}) => (
  <Surface
    title="Local Data"
    subtitle="Review what can be wiped before using ethagent reset."
    footer={footer}
  >
    <IdentitySummary identity={identity} config={config} />
    <Box flexDirection="column" marginTop={1}>
      {LOCAL_DATA_MANAGEMENT_COPY.map(line => (
        <Text key={line} color={theme.dim}>- {line}</Text>
      ))}
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.textSubtle}>Before reset: Alt+I {'->'} memory, persona, skills {'->'} save encrypted snapshot.</Text>
      <Text color={theme.textSubtle}>Run from the terminal: ethagent reset</Text>
    </Box>
    <Box marginTop={1}>
      <Select<'back'>
        options={[{ value: 'back', label: 'back to settings' }]}
        onSubmit={onBack}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)
