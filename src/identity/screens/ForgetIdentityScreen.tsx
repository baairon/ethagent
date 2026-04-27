import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'

type ForgetAction = 'confirm' | 'cancel'

export const FORGET_LOCAL_AGENT_COPY = [
  'removes the active local agent from this machine.',
  'does not burn, transfer, or delete agent tokens.',
  'does not delete pinned IPFS backups.',
  'does not delete sessions or chats.',
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
    title="forget local agent?"
    subtitle="this only removes the active agent from this device."
    footer={footer}
  >
    <IdentitySummary identity={identity} config={config} />
    <Box flexDirection="column" marginTop={1}>
      {FORGET_LOCAL_AGENT_COPY.map(line => (
        <Text key={line} color={theme.dim}>- {line}</Text>
      ))}
    </Box>
    <Box marginTop={1}>
      <Select<ForgetAction>
        options={[
          { value: 'confirm', label: 'forget local agent', hint: 'sessions and chats stay on this machine' },
          { value: 'cancel', label: 'keep it' },
        ]}
        onSubmit={choice => choice === 'confirm' ? onConfirm() : onCancel()}
        onCancel={onCancel}
      />
    </Box>
  </Surface>
)
