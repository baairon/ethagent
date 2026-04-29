import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import type { PrivateContinuityHistorySnapshot } from '../continuity/history.js'
import type { PublishedContinuitySnapshot } from '../continuity/snapshots.js'
import { shortCid } from '../identityHubModel.js'
import { IdentitySummary } from './IdentitySummary.js'

export type SnapshotWorkingStatus = {
  ready: boolean
  newestLocalChangeAt?: string
  localChangedAfterBackup: boolean
}

type SnapshotAction =
  | 'publish'
  | 'back'
  | `published:${string}`
  | `history:${string}`

type SnapshotManagerScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  ready: boolean
  canBackup: boolean
  notice?: string
  workingStatus?: SnapshotWorkingStatus | null
  publishedSnapshots: PublishedContinuitySnapshot[]
  localHistory: PrivateContinuityHistorySnapshot[]
  footer: React.ReactNode
  onPublish: () => void
  onRestorePublished: (snapshotId: string) => void
  onRestoreHistory: (snapshotId: string) => void
  onBack: () => void
}

export const SnapshotManagerScreen: React.FC<SnapshotManagerScreenProps> = ({
  identity,
  config,
  ready,
  canBackup,
  notice,
  workingStatus,
  publishedSnapshots,
  localHistory,
  footer,
  onPublish,
  onRestorePublished,
  onRestoreHistory,
  onBack,
}) => {
  const options: Array<SelectOption<SnapshotAction>> = [
    { value: 'publish', label: 'publish latest', disabled: !ready || !canBackup },
    ...publishedSnapshots.map(snapshot => ({
      value: `published:${snapshot.id}` as const,
      label: `published ${dateLabel(snapshot.createdAt)}  ${shortCid(snapshot.cid)}`,
    })),
    ...localHistory.map(snapshot => ({
      value: `history:${snapshot.id}` as const,
      label: `local ${dateLabel(snapshot.createdAt)}  ${fileLabel(snapshot.file)}`,
    })),
    { value: 'back', label: 'back' },
  ]

  return (
    <Surface title="snapshots" subtitle={notice ?? snapshotSubtitle(identity, workingStatus)} footer={footer}>
      <IdentitySummary identity={identity} config={config} compact />
      <Box flexDirection="column" marginTop={1}>
        <StatusRow label="status" value={localStatusLabel(workingStatus)} tone={workingStatus?.localChangedAfterBackup ? 'warn' : ready ? 'ok' : 'dim'} />
        <StatusRow label="latest" value={latestSnapshotLabel(identity)} tone={identity?.backup?.cid ? 'ok' : 'dim'} />
        <StatusRow label="saved" value={`${publishedSnapshots.length} published, ${localHistory.length} local`} tone={publishedSnapshots.length + localHistory.length > 0 ? 'ok' : 'dim'} />
      </Box>
      <Box marginTop={1}>
        <Select<SnapshotAction>
          options={options}
          maxVisible={7}
          onSubmit={choice => {
            if (choice === 'publish') return onPublish()
            if (choice === 'back') return onBack()
            if (choice.startsWith('published:')) return onRestorePublished(choice.slice('published:'.length))
            if (choice.startsWith('history:')) return onRestoreHistory(choice.slice('history:'.length))
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

export const SnapshotRestoreConfirmScreen: React.FC<{
  snapshot?: PrivateContinuityHistorySnapshot
  footer: React.ReactNode
  onConfirm: () => void
  onBack: () => void
}> = ({ snapshot, footer, onConfirm, onBack }) => (
  <Surface title="restore checkpoint" subtitle="set local markdown back to this checkpoint." footer={footer} tone="primary">
    <Box flexDirection="column">
      <Text color={theme.accentMint}>{snapshot?.changeSummary ?? 'checkpoint not found'}</Text>
      <Text color={theme.textSubtle}>{snapshot ? `${snapshot.file} - ${dateLabel(snapshot.createdAt)}` : 'go back and refresh snapshots.'}</Text>
      <Text color={theme.dim}>this changes local files only. publish after reviewing.</Text>
    </Box>
    <Box marginTop={1}>
      <Select<'confirm' | 'back'>
        options={[
          { value: 'confirm', label: 'restore checkpoint', disabled: !snapshot },
          { value: 'back', label: 'back' },
        ]}
        onSubmit={choice => {
          if (choice === 'confirm') return onConfirm()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

const StatusRow: React.FC<{ label: string; value: string; tone: 'ok' | 'warn' | 'dim' }> = ({ label, value, tone }) => {
  const color = tone === 'ok' ? theme.text : tone === 'warn' ? theme.accentPeach : theme.dim
  return (
    <Text>
      <Text color={theme.dim}>{label.padEnd(10)}</Text>
      <Text color={color}>{value}</Text>
    </Text>
  )
}

function snapshotSubtitle(identity: EthagentIdentity | undefined, status?: SnapshotWorkingStatus | null): string {
  if (!identity) return 'create or load an agent first.'
  if (!status?.ready) return 'restore private files first.'
  if (status.localChangedAfterBackup) return 'local changes need publishing.'
  return 'up to date.'
}

function localStatusLabel(status?: SnapshotWorkingStatus | null): string {
  if (!status?.ready) return 'not restored'
  if (status.localChangedAfterBackup) return `needs publish ${dateLabel(status.newestLocalChangeAt)}`
  return 'up to date'
}

function latestSnapshotLabel(identity?: EthagentIdentity): string {
  if (!identity?.backup?.cid) return 'not published'
  return `${dateLabel(identity.backup.createdAt)}  ${shortCid(identity.backup.cid)}`
}

function fileLabel(file: string): string {
  return file.replace(/\.md$/i, '').toLowerCase()
}

function dateLabel(input?: string): string {
  if (!input) return 'unknown'
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toISOString().slice(0, 10)
}
