import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'

type ForgetAction = 'confirm' | 'cancel'

export const FORGET_LOCAL_AGENT_COPY = [
  'clears only the active agent selection on this machine.',
  'does not burn, transfer, or delete agent tokens or pinned IPFS backups.',
  'does not delete SOUL.md, MEMORY.md, SKILLS.md, sessions, or chats.',
  'use ethagent reset when you want a full local wipe.',
] as const

type ForgetIdentityScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  footer: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}

export const ForgetIdentityScreen: React.FC<ForgetIdentityScreenProps> = ({
  identity,
  config,
  footer,
  onConfirm,
  onCancel,
}) => (
  <Surface
    title="unlink active agent?"
    subtitle="markdown, chats, token, and backups stay intact."
    footer={footer}
  >
    <IdentitySummary identity={identity} config={config} compact />
    <Box flexDirection="column" marginTop={1}>
      {FORGET_LOCAL_AGENT_COPY.map(line => (
        <Text key={line} color={theme.dim}>- {line}</Text>
      ))}
    </Box>
    <Box marginTop={1}>
      <Select<ForgetAction>
        options={[
          { value: 'confirm', role: 'section', prefix: '--', label: 'Active agent' },
          { value: 'confirm', label: 'unlink active agent', hint: 'clear only the selected identity from this device' },
          { value: 'cancel', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'cancel', label: 'keep active agent', hint: 'return without changing local identity data', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => choice === 'confirm' ? onConfirm() : onCancel()}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
