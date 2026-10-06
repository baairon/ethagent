import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
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
  const options: Array<SelectOption<Action>> = [
    { value: 'load-agent', label: 'Switch Agent', hint: 'Use another wallet' },
    { value: 'open-menu', label: 'Open Anyway', hint: 'Browse local files' },
    ...(onRetry ? [{ value: 'retry' as const, label: 'Check Again', hint: 'Recheck the owner', role: 'utility' as const }] : []),
  ]

  const tokenLabel = agentId ? `Token #${agentId}` : 'The agent token'
  const transferred = Boolean(transferSnapshotView(identity))

  return (
    <Surface
      title="Agent Unlinked"
      subtitle={transferred
        ? `${tokenLabel} was transferred to another wallet.`
        : `${tokenLabel} left this wallet without Prepare Transfer, so the new holder has no handoff.`}
      footer={<Text color={theme.dim}>↵ select · esc back</Text>}
    >
      <Paragraph color={theme.textSubtle}>Soul, memory, and skills are still on this machine. Save a copy before reusing them.</Paragraph>
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
