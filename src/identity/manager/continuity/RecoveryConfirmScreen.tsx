import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { localChangeStatusView, type LocalChangeStatusView } from './state.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

type RecoveryConfirmMode = 'publish' | 'refetch' | 'restore'

interface RecoveryConfirmScreenProps {
  mode: RecoveryConfirmMode
  workingStatus?: ContinuityWorkingTreeStatus | null
  pendingPublish?: boolean
  footer: React.ReactNode
  onConfirm: () => void
  onBack: () => void
}

export const RecoveryConfirmScreen: React.FC<RecoveryConfirmScreenProps> = ({ mode, workingStatus, pendingPublish, footer, onConfirm, onBack }) => {
  const isPublish = mode === 'publish'
  const isRestore = mode === 'restore'
  const title = isPublish
    ? 'Save Snapshot?'
    : isRestore
      ? 'Overwrite Local Changes?'
      : 'Refetch Latest From Onchain?'
  const subtitle = isPublish
    ? 'Saves SOUL.md, MEMORY.md, skills, and profile changes.'
    : isRestore
      ? 'This restore targets the active agent and overwrites local continuity files.'
      : 'This overwrites local files with the onchain version.'

  const localChangeStatus = localChangeStatusView(workingStatus)
  const body = isPublish
    ? <SaveSnapshotStatusLine status={localChangeStatus} />
    : localChangeStatus.hasLocalChanges
      ? <OverwriteStatusLine status={localChangeStatus} pendingPublish={pendingPublish} />
      : pendingPublish
        ? <Text color={theme.accentError} bold>Local snapshot is ahead of onchain; unsaved edits are discarded.</Text>
        : null
  const confirmLabel = isPublish
    ? 'Save Snapshot Now'
    : localChangeStatus.hasLocalChanges
      ? 'Overwrite Local Changes'
      : isRestore
        ? 'Restore'
        : 'Refetch'

  return (
    <Surface title={title} subtitle={subtitle} footer={footer} tone="primary">
      {body ? <Box flexDirection="column">{body}</Box> : null}
      <Box marginTop={1}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', label: confirmLabel },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'confirm') return onConfirm()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

const OverwriteStatusLine: React.FC<{ status: LocalChangeStatusView; pendingPublish?: boolean }> = ({ status, pendingPublish }) => (
  <Box flexDirection="column">
    <Text color={theme.textSubtle}>Unsaved local changes detected:</Text>
    <Text color={theme.accentError} bold>{status.files.length > 0 ? status.files.join(', ') : 'local files differ from saved snapshot'}</Text>
    <Text color={theme.accentError}>
      Continuing replaces those files with the restored snapshot.
    </Text>
    {pendingPublish ? (
      <Text color={theme.accentError}>Local snapshot is also ahead of onchain.</Text>
    ) : null}
  </Box>
)

const SaveSnapshotStatusLine: React.FC<{ status: LocalChangeStatusView }> = ({ status }) => {
  if (status.hasLocalChanges) {
    return (
      <Box flexDirection="column">
        <Text color={theme.textSubtle}>Local changes detected:</Text>
        <Text color={theme.accentError} bold>{status.files.length > 0 ? status.files.join(', ') : 'local files differ from saved snapshot'}</Text>
      </Box>
    )
  }

  if (!status.detail) return null

  const color = status.tone === 'ok' || status.tone === 'warn' ? theme.accentPeriwinkle : theme.dim
  const label = status.detail === 'None detected' ? 'No local changes detected.' : status.detail
  return <Text color={color}>{label}</Text>
}
