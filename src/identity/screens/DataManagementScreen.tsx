import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'

export const LOCAL_DATA_MANAGEMENT_COPY = [
  'SOUL.md and MEMORY.md are private local continuity files; SKILLS.md is public discovery metadata.',
  'Save snapshot and publish encrypts private markdown, pins it to IPFS, and updates tokenURI metadata.',
  'Unlink active agent only removes the selected agent from this device.',
  'ethagent reset wipes local identity metadata, markdown vaults, sessions, history, permissions, and credentials.',
  'ethagent reset keeps local LLM assets and cannot delete onchain tokens or IPFS pins.',
] as const

type DataManagementScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  footer: React.ReactNode
  onForgetLocalData: () => void
  onBack: () => void
}

export const DataManagementScreen: React.FC<DataManagementScreenProps> = ({
  identity,
  config,
  footer,
  onForgetLocalData,
  onBack,
}) => (
  <Surface
    title="local data"
    subtitle="review what reset changes on this machine."
    footer={footer}
  >
    <IdentitySummary identity={identity} config={config} compact />
    <Box flexDirection="column" marginTop={1}>
      {LOCAL_DATA_MANAGEMENT_COPY.map(line => (
        <Text key={line} color={theme.dim}>- {line}</Text>
      ))}
    </Box>
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.textSubtle}>before reset: use snapshots to publish local continuity.</Text>
      <Text color={theme.textSubtle}>terminal: ethagent reset</Text>
    </Box>
    <Box marginTop={1}>
      <Select<'unlink' | 'back'>
        options={[
          { value: 'unlink', role: 'section', prefix: '--', label: 'Active agent' },
          { value: 'unlink', label: 'unlink active agent', hint: 'remove active identity selection only', disabled: !identity },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to settings', hint: 'return without changing local data', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => choice === 'unlink' ? onForgetLocalData() : onBack()}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)
