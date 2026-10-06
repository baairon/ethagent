import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import { localChangeStatusView } from './state.js'
import { ChangeList } from './ChangeList.js'

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

const COPY: Record<RecoveryConfirmMode, { title: string; subtitle: string; confirm: string; discard: string }> = {
  publish: {
    title: 'Save Snapshot',
    subtitle: 'Publishes an encrypted snapshot onchain.',
    confirm: 'Save Snapshot',
    discard: 'Save Snapshot',
  },
  refetch: {
    title: 'Refetch Latest Snapshot',
    subtitle: 'Replaces local files with the latest save.',
    confirm: 'Refetch',
    discard: 'Discard Changes and Refetch',
  },
  restore: {
    title: 'Replace Local Files?',
    subtitle: 'Restoring overwrites this agent\'s files.',
    confirm: 'Restore',
    discard: 'Discard Changes and Restore',
  },
}

export const RecoveryConfirmScreen: React.FC<RecoveryConfirmScreenProps> = ({ mode, workingStatus, pendingPublish, footer, onConfirm, onBack }) => {
  const copy = COPY[mode]
  const status = localChangeStatusView(workingStatus)
  const destructive = mode !== 'publish' && (status.hasLocalChanges || Boolean(pendingPublish))

  const changes = (heading: string): React.ReactNode => status.items.length > 0
    ? <ChangeList heading={heading} items={status.items} />
    : <Paragraph color={theme.accentError}>Local files differ from your last snapshot.</Paragraph>

  let body: React.ReactNode = null
  if (mode === 'publish') {
    body = status.hasLocalChanges
      ? changes('Changes since your last snapshot')
      : status.detail
        ? <Paragraph color={theme.dim}>{status.detail === 'None detected' ? 'No changes since your last snapshot.' : status.detail}</Paragraph>
        : null
  } else {
    body = (
      <Box flexDirection="column">
        {status.hasLocalChanges ? changes('These unsaved changes will be lost') : null}
        {pendingPublish ? (
          <Box marginTop={status.hasLocalChanges ? 1 : 0}>
            <Paragraph color={theme.accentError}>A newer local snapshot is not onchain yet. It is replaced too.</Paragraph>
          </Box>
        ) : null}
      </Box>
    )
  }

  return (
    <Surface title={copy.title} subtitle={copy.subtitle} footer={footer} tone="primary">
      {body}
      <Box marginTop={body ? 1 : 0}>
        <Select<'confirm' | 'back'>
          options={[
            { value: 'confirm', label: status.hasLocalChanges ? copy.discard : copy.confirm },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          initialIndex={destructive ? 1 : 0}
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
