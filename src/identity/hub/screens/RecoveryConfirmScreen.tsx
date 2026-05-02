import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { localChangeStatusView, type LocalChangeStatusView } from '../identityHubModel.js'

import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'

export type RecoveryConfirmMode = 'publish' | 'refetch'

type RecoveryConfirmScreenProps = {
  mode: RecoveryConfirmMode
  workingStatus?: ContinuityWorkingTreeStatus | null
  footer: React.ReactNode
  onConfirm: () => void
  onBack: () => void
}

export const RecoveryConfirmScreen: React.FC<RecoveryConfirmScreenProps> = ({ mode, workingStatus, footer, onConfirm, onBack }) => {
  const isPublish = mode === 'publish'
  const title = isPublish ? 'Save Snapshot?' : 'Refetch Latest From Chain?'
  const subtitle = isPublish
    ? 'Saves any local edits to SOUL.md, MEMORY.md, skills.json, and public profile.'
    : 'This overwrites local files with the on-chain version.'

  const headlineColor = isPublish ? theme.accentPeach : theme.accentMint
  const headline = isPublish
    ? 'Saving updates the on-chain pointer for this agent.'
    : 'Refetching replaces local SOUL.md, MEMORY.md, and skills.json with what is on chain.'
  const detail = isPublish
    ? 'Any local edits to SOUL.md, MEMORY.md, skills.json, and public profile become the saved state. The previous snapshot pointer is overwritten.'
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
        {!isPublish && (
          <Box marginTop={1}>
            <Text color={theme.accentPeach}>Overwrite your local files?</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', role: 'section', prefix: '--', label: isPublish ? 'Save' : 'Refetch' },
            {
              value: 'confirm',
              label: isPublish ? 'Yes, Save Snapshot Now' : 'Yes, Refetch From Chain',
              hint: isPublish ? 'Sign and save the encrypted snapshot' : 'Wallet decrypts and overwrites local files',
            },
            { value: 'back', role: 'section', prefix: '--', label: 'Cancel' },
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
        <Text color="#e87070" bold>{status.files.length > 0 ? status.files.join(', ') : 'local files differ from saved snapshot'}</Text>
      </Text>
    )
  }

  const color = status.tone === 'ok' ? theme.accentMint : status.tone === 'warn' ? theme.accentPeach : theme.dim
  const label = status.detail === 'None detected' ? 'No local changes detected.' : status.detail
  return <Text color={color}>{label}</Text>
}
