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
  const title = mode === 'first-run' ? 'Set Up Agent Identity' : 'Identity Hub'
  const subtitle = mode === 'first-run'
    ? 'Create a portable agent or load one you already own.'
    : 'Public, private, recovery, storage, and device controls are separate.'

  const canRefetch = Boolean(canRebackup && identity?.backup?.cid)

  const options: Array<SelectOption<Action>> = identity
    ? [
        { value: 'public-profile', role: 'section', prefix: '--', label: 'Public Metadata' },
        { value: 'public-profile', label: 'Public Profile', hint: 'Name, image, skills.json, Agent Card' },
        { value: 'private-memory', role: 'section', prefix: '--', label: 'Private Local Files' },
        { value: 'private-memory', label: 'Memory and Persona', hint: 'SOUL.md and MEMORY.md only on this device' },
        { value: 'backup', role: 'section', prefix: '--', label: 'Recovery' },
        { value: 'backup', label: 'Save Snapshot Now', hint: 'Saves any local edits to SOUL.md, MEMORY.md, skills.json, and public profile', disabled: !canRebackup },
        { value: 'refetch', label: 'Refetch Latest Snapshot', hint: 'Restore local files from the latest saved snapshot', disabled: !canRefetch },
        { value: 'storage-credential', role: 'section', prefix: '--', label: 'Storage' },
        { value: 'storage-credential', label: 'IPFS Credential', hint: 'Save, replace, or forget Pinata JWT' },
        { value: 'copy', role: 'section', prefix: '--', label: 'Agent Token' },
        { value: 'copy', label: 'Copy Values', hint: 'Copy CIDs, token ID, URI, or owner' },
        { value: 'load', label: 'Switch Agent', hint: 'Load a different token owned by your wallet' },
        { value: 'create', label: 'New Agent', hint: 'Mint another token and make it active here' },
        { value: 'cancel', role: 'section', prefix: '--', label: 'Exit' },
        { value: 'cancel', label: 'Close Hub', hint: 'Return to chat without changing identity', role: 'utility' },
      ]
    : [
        { value: 'create', role: 'section', prefix: '--', label: 'Setup' },
        { value: 'create', label: 'Create New Agent', hint: 'Mint a wallet-owned token for this machine' },
        { value: 'load', label: 'Load Existing Agent', hint: 'Find an agent token your wallet already owns' },
        { value: 'skip', role: 'section', prefix: '--', label: 'Exit' },
        ...(mode === 'first-run'
          ? [{ value: 'skip' as Action, label: 'Skip For Now', hint: 'Continue now; use /identity later', role: 'utility' as const }]
          : [{ value: 'cancel' as Action, label: 'Close Hub', hint: 'Return to chat without changing identity', role: 'utility' as const }]),
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
