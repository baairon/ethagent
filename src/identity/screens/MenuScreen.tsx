import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'

type MenuScreenProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  identity?: EthagentIdentity
  canRebackup: boolean
  footer: React.ReactNode
  onCreate: () => void
  onLoad: () => void
  onBackupNow: () => void
  onDetails: () => void
  onSkip: () => void
  onCancel: () => void
}

type Action = 'create' | 'load' | 'backup' | 'details' | 'skip' | 'cancel'

export const MenuScreen: React.FC<MenuScreenProps> = ({
  mode,
  config,
  identity,
  canRebackup,
  footer,
  onCreate,
  onLoad,
  onBackupNow,
  onDetails,
  onSkip,
  onCancel,
}) => {
  const title = mode === 'first-run' ? 'Set Up Agent Identity' : 'Agent Identity'
  const subtitle = mode === 'first-run'
    ? 'Create a portable agent or load one you already own.'
    : 'Back up, switch, or start a new one.'

  const options: Array<SelectOption<Action>> = identity
    ? [
        { value: 'backup', role: 'section', prefix: '--', label: 'Backup' },
        { value: 'backup', label: 'save snapshot', hint: 'encrypt state, pin to IPFS, refresh metadata', disabled: !canRebackup },
        { value: 'load', role: 'section', prefix: '--', label: 'Identity' },
        { value: 'load', label: 'switch agent', hint: 'load a different agent token owned by your wallet' },
        { value: 'create', label: 'new agent', hint: 'mint another token and make it active here' },
        { value: 'details', label: 'settings', hint: 'profile, continuity, storage, local data' },
        { value: 'cancel', role: 'section', prefix: '--', label: 'Exit' },
        { value: 'cancel', label: 'close hub', hint: 'return to the chat without changing identity', role: 'utility' },
      ]
    : [
        { value: 'create', role: 'section', prefix: '--', label: 'Setup' },
        { value: 'create', label: 'create new agent', hint: 'mint a wallet-owned token for this machine' },
        { value: 'load', label: 'load existing agent', hint: 'find an agent token your wallet already owns' },
        { value: 'skip', role: 'section', prefix: '--', label: 'Exit' },
        ...(mode === 'first-run'
          ? [{ value: 'skip' as Action, label: 'skip for now', hint: 'continue now; use /identity later', role: 'utility' as const }]
          : [{ value: 'cancel' as Action, label: 'close hub', hint: 'return to the chat without changing identity', role: 'utility' as const }]),
      ]

  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} compact={Boolean(identity)} />
      <Box marginTop={1}>
        <Select<Action>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'skip') return onSkip()
            if (choice === 'cancel') return onCancel()
            if (choice === 'details') return onDetails()
            if (choice === 'backup') return onBackupNow()
            if (choice === 'load') return onLoad()
            if (choice === 'create') return onCreate()
          }}
          onCancel={() => mode === 'first-run' ? onSkip() : onCancel()}
        />
      </Box>
    </Surface>
  )
}
