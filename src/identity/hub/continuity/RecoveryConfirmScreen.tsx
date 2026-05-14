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
  const title = isPublish ? 'Save Snapshot?' : 'Refetch Latest From Chain?'
  const subtitle = isPublish
    ? 'Saves SOUL.md, MEMORY.md, skills.json, and profile changes.'
    : 'This overwrites local files with the onchain version.'

  const headlineColor = theme.accentPeriwinkle
  const headline = isPublish
    ? 'Saving updates the onchain pointer for this agent.'
    : 'Refetching replaces SOUL.md, MEMORY.md, and skills.json with what is onchain.'
  const detail = isPublish
    ? 'Your local continuity files and profile edits become the saved state. The previous snapshot pointer is overwritten.'
    : 'Unsaved local edits will be lost. Use this when local files are missing or out of sync with the latest saved snapshot.'

  const localChangeStatus = localChangeStatusView(workingStatus)

  return (
    <Surface title={title} subtitle={subtitle} footer={footer} tone="primary">
      <Box flexDirection="column">
        <Text color={headlineColor}>{headline}</Text>
        <Text color={theme.textSubtle}>{detail}</Text>
        {isPublish && (
          <Box marginTop={1}>
            <SaveSnapshotStatusLine status={localChangeStatus} />
          </Box>
        )}
        {!isPublish && pendingPublish ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.accentError} bold>Local snapshot is ahead of chain.</Text>
            <Text color={theme.textSubtle}>Local edits have not yet been rotated to the onchain pointer. Refetching discards them and reverts to the last published snapshot.</Text>
          </Box>
        ) : null}
        {!isPublish && (
          <Box marginTop={1}>
            <Text color={theme.accentPeriwinkle}>Overwrite your local files?</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', role: 'section', label: isPublish ? 'Save' : 'Refetch' },
            {
              value: 'confirm',
              label: isPublish ? 'Yes, Save Snapshot Now' : 'Yes, Refetch From Chain',
              hint: isPublish ? 'Sign and save the encrypted snapshot' : 'Wallet decrypts and overwrites local files',
            },
            { value: 'back', role: 'section', label: 'Navigation' },
            {
              value: 'back',
              label: 'No, Go Back',
              hint: isPublish ? 'Return without saving anything' : 'Return without changing anything',
              role: 'utility',
            },
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
