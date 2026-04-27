import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
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
  const title = mode === 'first-run' ? 'set up your agent' : 'your agent'
  const subtitle = mode === 'first-run'
    ? 'create a portable agent or load one you already own.'
    : 'back up, switch, or start a new one. yours stays loadable.'

  const options: Array<{ value: Action; label: string; hint?: string; disabled?: boolean }> = identity
    ? [
        { value: 'backup', label: 'back up', hint: 'snapshot encrypted memory and refresh tokenURI', disabled: !canRebackup },
        { value: 'load', label: 'switch agent', hint: 'pick a different token your wallet holds' },
        { value: 'create', label: 'create new agent', hint: 'your current agent stays loadable. you can switch back any time.' },
        { value: 'details', label: 'agent settings', hint: 'profile, technical values, storage, local cleanup' },
        { value: 'cancel', label: 'close' },
      ]
    : [
        { value: 'create', label: 'create new agent', hint: 'mint an agent token with your wallet' },
        { value: 'load', label: 'load existing agent', hint: 'find an agent token your wallet already holds' },
        ...(mode === 'first-run'
          ? [{ value: 'skip' as Action, label: 'skip for now', hint: 'come back any time with /identity' }]
          : [{ value: 'cancel' as Action, label: 'close' }]),
      ]

  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} />
      <Box marginTop={1}>
        <Select<Action>
          options={options}
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
