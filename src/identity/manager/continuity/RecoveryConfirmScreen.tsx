import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { localChangeStatusView, type LocalChangeStatusView } from './state.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

type RecoveryConfirmMode = 'publish' | 'refetch'

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
  const title = isPublish ? 'Save Snapshot?' : 'Refetch Latest From Onchain?'
  const subtitle = isPublish
    ? 'Saves SOUL.md, MEMORY.md, skills, and profile changes.'
    : 'This overwrites local files with the onchain version.'

  const localChangeStatus = localChangeStatusView(workingStatus)
  const body = isPublish
    ? <SaveSnapshotStatusLine status={localChangeStatus} />
    : pendingPublish
      ? <Text color={theme.accentError} bold>Local snapshot is ahead of onchain; unsaved edits are discarded.</Text>
      : null

  return (
    <Surface title={title} subtitle={subtitle} footer={footer} tone="primary">
      {body ? <Box flexDirection="column">{body}</Box> : null}
      <Box marginTop={1}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', label: isPublish ? 'Save Snapshot Now' : 'Refetch' },
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

const SaveSnapshotStatusLine: React.FC<{ status: LocalChangeStatusView }> = ({ status }) => {
  if (status.hasLocalChanges) {
    return (
      <Text>
        <Text color={theme.textSubtle}>Local changes detected: </Text>
        <Text color={theme.accentError} bold>{status.files.length > 0 ? status.files.join(', ') : 'local files differ from saved snapshot'}</Text>
      </Text>
    )
  }

  if (!status.detail) return null

  const color = status.tone === 'ok' || status.tone === 'warn' ? theme.accentPeriwinkle : theme.dim
  const label = status.detail === 'None detected' ? 'No local changes detected.' : status.detail
  return <Text color={color}>{label}</Text>
}
