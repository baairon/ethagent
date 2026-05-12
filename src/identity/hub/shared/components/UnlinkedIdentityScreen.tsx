import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import { transferSnapshotView } from '../../transfer/state.js'
import type { EthagentIdentity } from '../../../../storage/config.js'

type UnlinkedIdentityScreenProps = {
  identity?: EthagentIdentity
  agentId?: string
  onLoadAgent: () => void
  onOpenMenu: () => void
  onRetry?: () => void
  onCancel: () => void
}

type Action = 'load-agent' | 'open-menu' | 'retry'

export const UnlinkedIdentityScreen: React.FC<UnlinkedIdentityScreenProps> = ({
  identity,
  agentId,
  onLoadAgent,
  onOpenMenu,
  onRetry,
  onCancel,
}) => {
  const options: Array<{ value: Action; label: string; hint?: string; role?: 'section' | 'utility' }> = [
    { value: 'load-agent', role: 'section', label: 'Load Agent' },
    { value: 'load-agent', label: 'Load Agent', hint: 'Reconnect this token by signing with the current owner wallet, or load a different one' },
    { value: 'open-menu', role: 'section', label: 'Identity Hub' },
    { value: 'open-menu', label: 'Open Identity Hub', hint: 'Browse local identity, continuity files, and settings without reconnecting' },
  ]
  if (onRetry) {
    options.push({ value: 'retry', role: 'section', label: 'Recheck' })
    options.push({ value: 'retry', label: 'Retry Ownership Check', hint: 'Re-query the chain to confirm the current owner', role: 'utility' })
  }

  const tokenLabel = agentId ? `Token #${agentId}` : 'Token'
  const transferSnapshot = transferSnapshotView(identity)

  return (
    <Surface
      title="No Linked Agent"
      subtitle="The agent token recorded locally is not currently owned by your wallet."
      footer={<Text color={theme.dim}>enter selects, esc back</Text>}
    >
      <Box flexDirection="column">
        {transferSnapshot ? (
          <Text color={theme.textSubtle}>
            {tokenLabel} was transferred. Local SOUL.md, MEMORY.md, skills.json remain. Back them up before this directory is reused.
          </Text>
        ) : (
          <>
            <Text color={theme.accentPeriwinkle}>{tokenLabel} left this wallet without Prepare Transfer, so the new holder has no continuity handoff.</Text>
            <Text color={theme.textSubtle}>
              Local SOUL.md, MEMORY.md, skills.json remain. Back them up before this directory is reused.
            </Text>
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<Action>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'load-agent') return onLoadAgent()
            if (choice === 'open-menu') return onOpenMenu()
            if (choice === 'retry') return onRetry?.()
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}
