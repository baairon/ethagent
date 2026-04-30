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
    { value: 'publish', role: 'section', prefix: '--', label: 'Publish' },
    { value: 'publish', label: 'publish latest', hint: 'encrypt local continuity and pin to IPFS', disabled: !ready || !canBackup },
    ...(publishedSnapshots.length > 0 ? [{ value: 'publish' as const, role: 'section' as const, prefix: '--', label: 'Published snapshots' }] : []),
    ...publishedSnapshots.map(snapshot => ({
      value: `published:${snapshot.id}` as const,
      label: `published ${dateLabel(snapshot.createdAt)}  ${shortCid(snapshot.cid)}`,
      hint: 'restore this pinned encrypted snapshot',
    })),
    ...(localHistory.length > 0 ? [{ value: 'publish' as const, role: 'section' as const, prefix: '--', label: 'Local checkpoints' }] : []),
    ...localHistory.map(snapshot => ({
      value: `history:${snapshot.id}` as const,
      label: `local ${dateLabel(snapshot.createdAt)}  ${fileLabel(snapshot.file)}`,
      hint: 'restore this local markdown checkpoint',
    })),
    { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
    { value: 'back', label: 'back to continuity', hint: 'return to memory and persona', role: 'utility' },
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
          hintLayout="inline"
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
          { value: 'confirm', role: 'section', prefix: '--', label: 'Checkpoint' },
          { value: 'confirm', label: 'restore checkpoint', hint: 'replace local markdown with this saved version', disabled: !snapshot },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to snapshots', hint: 'return without changing local files', role: 'utility' },
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
