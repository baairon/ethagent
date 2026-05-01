import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../continuity/storage.js'
import type { PrivateContinuityHistorySnapshot } from '../continuity/history.js'
import type { PublishedContinuitySnapshot } from '../continuity/snapshots.js'
import { shortCid } from '../identityHubModel.js'
import { IdentitySummary } from './IdentitySummary.js'

export type SnapshotWorkingStatus = ContinuityWorkingTreeStatus

type SnapshotAction =
  | 'publish'
  | 'view-full-history'
  | 'back'
  | `published:${string}`
  | `history:${string}`

type SnapshotManagerScreenProps = {
  mode: 'onchain-backups' | 'full-history'
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
  onFullHistory?: () => void
  onRestorePublished: (snapshotId: string) => void
  onRestoreHistory: (snapshotId: string) => void
  onBack: () => void
}

export const SnapshotManagerScreen: React.FC<SnapshotManagerScreenProps> = ({
  mode,
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
  onFullHistory,
  onRestorePublished,
  onRestoreHistory,
  onBack,
}) => {
  const allPublished = React.useMemo(() => {
    const combined: Array<{ id: string; cid: string; createdAt?: string; label: string }> = []
    if (identity?.backup?.cid) {
      combined.push({
        id: identity.backup.cid,
        cid: identity.backup.cid,
        createdAt: identity.backup.createdAt,
        label: 'latest'
      })
      for (const past of identity.backup.pastBackups ?? []) {
        if (!combined.some(c => c.cid === past.cid)) {
          combined.push({
            id: past.cid,
            cid: past.cid,
            createdAt: past.createdAt,
            label: 'past'
          })
        }
      }
    }
    for (const local of publishedSnapshots) {
      if (!combined.some(c => c.cid === local.cid)) {
        combined.push({
          id: local.id,
          cid: local.cid,
          createdAt: local.createdAt,
          label: 'local'
        })
      }
    }
    return combined.sort((a, b) => {
      const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bDate - aDate
    })
  }, [identity?.backup, publishedSnapshots])

  const options: Array<SelectOption<SnapshotAction>> = mode === 'onchain-backups' ? [
    ...(allPublished.length > 0 ? [{ value: 'back' as const, role: 'section' as const, prefix: '--', label: 'Backups' }] : []),
    ...allPublished.slice(0, 5).map((snapshot, index) => {
      const version = allPublished.length - index
      return {
        value: `published:${snapshot.id}` as const,
        label: `backup ${shortCid(snapshot.cid)}`,
        subtext: [
          dateLabel(snapshot.createdAt),
          `v${version}`,
          snapshot.label === 'latest' ? 'latest backup' : 'past backup',
          'pinned encrypted snapshot'
        ].filter(Boolean).join(' · '),
        role: 'option' as const,
      }
    }),
    ...(allPublished.length > 5 ? [
      { value: 'back' as const, role: 'section' as const, prefix: '--', label: 'More' },
      { value: 'view-full-history' as const, label: 'view full history', hint: `see all ${allPublished.length} backups`, role: 'utility' as const }
    ] : []),
    { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
    { value: 'back', label: 'back to identity hub', hint: 'return to top-level identity actions', role: 'utility' },
  ] : [
    ...(allPublished.length > 0 ? [{ value: 'back' as const, role: 'section' as const, prefix: '--', label: 'Full Backup History' }] : []),
    ...allPublished.map((snapshot, index) => {
      const version = allPublished.length - index
      return {
        value: `published:${snapshot.id}` as const,
        label: `v${version} · ${shortCid(snapshot.cid)}`,
        subtext: dateLabel(snapshot.createdAt) || 'unknown date',
        role: 'option' as const,
      }
    }),
    { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
    { value: 'back', label: 'back to onchain backups', hint: 'return to recent backups', role: 'utility' },
  ]

  return (
    <Surface title={mode === 'onchain-backups' ? 'onchain backups' : 'full backup history'} subtitle={notice ?? snapshotSubtitle(identity, workingStatus)} footer={footer}>
      {mode === 'onchain-backups' && <IdentitySummary identity={identity} config={config} compact />}
      {mode === 'onchain-backups' && (
        <Box flexDirection="column" marginTop={1}>
          <StatusRow label="latest" value={latestSnapshotLabel(identity)} tone={identity?.backup?.cid ? 'ok' : 'dim'} />
          <StatusRow label="saved" value={`${allPublished.length} published`} tone={allPublished.length > 0 ? 'ok' : 'dim'} />
        </Box>
      )}
      <Box marginTop={1}>
        <Select<SnapshotAction>
          options={options}
          maxVisible={7}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'publish') return onPublish()
            if (choice === 'back') return onBack()
            if (choice === 'view-full-history') return onFullHistory?.()
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
  if (status.publishState === 'local-changes') return 'local changes need publishing.'
  if (status.publishState === 'verify-needed') return 'unknown local status; consider publishing.'
  if (status.publishState === 'not-published') return 'publish a snapshot to back up local markdown.'
  return 'up to date.'
}

function localStatusLabel(status?: SnapshotWorkingStatus | null): string {
  if (!status?.ready) return 'not restored'
  switch (status.publishState) {
    case 'not-published':
      return 'not published'
    case 'verify-needed':
      return 'status unknown'
    case 'local-changes':
      return `local changes ${dateLabel(status.newestLocalChangeAt)}`
    case 'published':
      return 'matches published'
    default:
      return 'not restored'
  }
}

function statusTone(status: SnapshotWorkingStatus | null | undefined, ready: boolean): 'ok' | 'warn' | 'dim' {
  if (!ready || !status) return 'dim'
  if (status.publishState === 'published') return 'ok'
  if (status.publishState === 'local-changes' || status.publishState === 'verify-needed') return 'warn'
  return 'dim'
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
