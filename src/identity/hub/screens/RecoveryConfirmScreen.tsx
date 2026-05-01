import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'

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
  const title = isPublish ? 'Publish Snapshot?' : 'Refetch Latest From Chain?'
  const subtitle = isPublish
    ? 'This replaces the current on-chain snapshot pointer.'
    : 'This overwrites local files with the on-chain version.'

  const headlineColor = isPublish ? theme.accentPeach : theme.accentMint
  const headline = isPublish
    ? 'Publishing replaces the on-chain pointer for this agent.'
    : 'Refetching replaces local SOUL.md, MEMORY.md, and skills.json with what is on chain.'
  const detail = isPublish
    ? 'The old snapshot pointer is overwritten. Local edits become the published state.'
    : 'Unsaved local edits will be lost. Use this when local files are missing or out of sync with the latest published snapshot.'

  const needsBackup = workingStatus?.publishState === 'local-changes' || workingStatus?.publishState === 'not-published' || workingStatus?.publishState === 'verify-needed'
  let changedFiles: string[] = []
  if (isPublish && needsBackup) {
    if (workingStatus?.localContentHashes && workingStatus?.publishedContentHashes) {
      if (workingStatus.localContentHashes['SOUL.md'] !== workingStatus.publishedContentHashes['SOUL.md']) changedFiles.push('SOUL.md')
      if (workingStatus.localContentHashes['MEMORY.md'] !== workingStatus.publishedContentHashes['MEMORY.md']) changedFiles.push('MEMORY.md')
      if (workingStatus.localContentHashes['skills.json'] !== workingStatus.publishedContentHashes['skills.json']) changedFiles.push('skills.json')
    } else {
      changedFiles = ['SOUL.md', 'MEMORY.md', 'skills.json']
    }
  }

  return (
    <Surface title={title} subtitle={subtitle} footer={footer} tone="primary">
      <Box flexDirection="column">
        <Text color={headlineColor}>{headline}</Text>
        <Text color={theme.textSubtle}>{detail}</Text>
        {isPublish && changedFiles.length > 0 && (
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>unsaved changes: </Text>
            <Text color="red" bold>{changedFiles.join(', ')}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', role: 'section', prefix: '--', label: isPublish ? 'Publish' : 'Refetch' },
            {
              value: 'confirm',
              label: isPublish ? 'Yes, Publish Snapshot Now' : 'Yes, Refetch From Chain',
              hint: isPublish ? 'Sign and overwrite the on-chain pointer' : 'Wallet decrypts and overwrites local files',
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
