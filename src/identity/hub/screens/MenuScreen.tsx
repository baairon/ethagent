import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { IdentitySummary } from './IdentitySummary.js'

type MenuScreenProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  identity?: EthagentIdentity
  workingStatus?: ContinuityWorkingTreeStatus | null
  canRebackup: boolean
  footer: React.ReactNode
  onCreate: () => void
  onLoad: () => void
  onBackupNow: () => void
  onRefetchLatest: () => void
  onPublicProfile: () => void
  onPrivateMemory: () => void
  onCopyValues: () => void
  onStorageCredential: () => void
  onSkip: () => void
  onCancel: () => void
}

type Action =
  | 'public-profile'
  | 'private-memory'
  | 'backup'
  | 'refetch'
  | 'copy'
  | 'storage-credential'
  | 'create'
  | 'load'
  | 'skip'
  | 'cancel'

export const MenuScreen: React.FC<MenuScreenProps> = ({
  mode,
  config,
  identity,
  workingStatus,
  canRebackup,
  footer,
  onCreate,
  onLoad,
  onBackupNow,
  onRefetchLatest,
  onPublicProfile,
  onPrivateMemory,
  onCopyValues,
  onStorageCredential,
  onSkip,
  onCancel,
}) => {
  const title = mode === 'first-run' ? 'Set Up Agent Identity' : 'Agent Identity'
  const subtitle = mode === 'first-run'
    ? 'Create a portable agent or load one you already own.'
    : 'Public, private, recovery, storage, and device controls are separate.'

  const canRefetch = Boolean(canRebackup && identity?.backup?.cid)

  const options: Array<SelectOption<Action>> = identity
    ? [
        { value: 'public-profile', role: 'section', prefix: '--', label: 'Public metadata' },
        { value: 'public-profile', label: 'public profile', hint: 'name, image, skills.json, agent card' },
        { value: 'private-memory', role: 'section', prefix: '--', label: 'Private local files' },
        { value: 'private-memory', label: 'memory and persona', hint: 'SOUL.md and MEMORY.md only on this device' },
        { value: 'backup', role: 'section', prefix: '--', label: 'Recovery' },
        { value: 'backup', label: 'publish snapshot now', hint: 'publishes SOUL.md, MEMORY.md, skills.json, and metadata', disabled: !canRebackup },
        { value: 'refetch', label: 'refetch latest snapshot', hint: 'restore local files from the latest published snapshot', disabled: !canRefetch },
        { value: 'storage-credential', role: 'section', prefix: '--', label: 'Storage' },
        { value: 'storage-credential', label: 'IPFS credential', hint: 'save, replace, or forget Pinata JWT' },
        { value: 'copy', role: 'section', prefix: '--', label: 'Agent token' },
        { value: 'copy', label: 'copy values', hint: 'copy CIDs, token id, URI, or owner' },
        { value: 'load', label: 'switch agent', hint: 'load a different token owned by your wallet' },
        { value: 'create', label: 'new agent', hint: 'mint another token and make it active here' },
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
      <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact={Boolean(identity)} />
      <Box marginTop={1}>
        <Select<Action>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'skip') return onSkip()
            if (choice === 'cancel') return onCancel()
            if (choice === 'public-profile') return onPublicProfile()
            if (choice === 'private-memory') return onPrivateMemory()
            if (choice === 'backup') return onBackupNow()
            if (choice === 'refetch') return onRefetchLatest()
            if (choice === 'copy') return onCopyValues()
            if (choice === 'storage-credential') return onStorageCredential()
            if (choice === 'load') return onLoad()
            if (choice === 'create') return onCreate()
          }}
          onCancel={() => mode === 'first-run' ? onSkip() : onCancel()}
        />
      </Box>
    </Surface>
  )
}
