import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from './Surface.js'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { theme } from './theme.js'
import {
  listRewindEntries,
  rewindWorkspaceEditsByEntryIds,
  type RewindEntry,
} from '../storage/rewind.js'

type RestoreAction = 'both' | 'code' | 'conversation'

type RewindViewProps = {
  cwd: string
  currentSessionId: string
  onRestoreConversation: (turnId: string) => void
  onDone: (message: string, variant?: 'info' | 'error' | 'dim') => void
  onCancel: () => void
}

type ReadyState = {
  kind: 'ready'
  entries: RewindEntry[]
  offset: number
  pageSize: number
  hasMore: boolean
  selectedFilePath: string | null
  selectedId: string | null
  selectedAction: RestoreAction
  stage: 'files' | 'entries' | 'actions'
  restoring: boolean
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | ReadyState

export const RewindView: React.FC<RewindViewProps> = ({
  cwd,
  currentSessionId,
  onRestoreConversation,
  onDone,
  onCancel,
}) => {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const pageSize = 12

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const entries = await listRewindEntries(cwd, { limit: pageSize, offset: 0 })
        if (cancelled) return
        const firstFilePath = entries[0]?.filePath ?? null
        const firstEntryId = entries.find(entry => entry.filePath === firstFilePath)?.id ?? null
        setState({
          kind: 'ready',
          entries,
          offset: entries.length,
          pageSize,
          hasMore: entries.length === pageSize,
          selectedFilePath: firstFilePath,
          selectedId: firstEntryId,
          selectedAction: 'code',
          stage: 'files',
          restoring: false,
        })
      } catch (err: unknown) {
        if (cancelled) return
        setState({ kind: 'error', message: (err as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [cwd, pageSize])

  if (state.kind === 'loading') {
    return (
      <Surface title="Rewind" subtitle="loading checkpoints...">
        <Spinner label="loading rewind history..." />
      </Surface>
    )
  }

  if (state.kind === 'error') {
    return (
      <Surface title="Rewind" tone="muted" footer="esc closes">
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.entries.length === 0) {
    return (
      <Surface title="Rewind" tone="muted" footer="esc closes">
        <Text color={theme.dim}>No managed edits are available to rewind in this workspace.</Text>
      </Surface>
    )
  }

  const fileEntries = dedupeFiles(state.entries)
  const scopedEntries = state.selectedFilePath
    ? state.entries.filter(entry => entry.filePath === state.selectedFilePath)
    : []
  const selectedFile = fileEntries.find(entry => entry.filePath === state.selectedFilePath) ?? fileEntries[0]!
  const selectedEntry = scopedEntries.find(entry => entry.id === state.selectedId) ?? scopedEntries[0] ?? selectedFile
  const canRestoreConversation = Boolean(selectedEntry.turnId && selectedEntry.sessionId === currentSessionId)

  const executeRestore = async (action: RestoreAction) => {
    setState(prev => prev.kind === 'ready' ? { ...prev, restoring: true, selectedAction: action } : prev)
    try {
      if (action === 'conversation') {
        if (!selectedEntry.turnId || !canRestoreConversation) {
          onDone('conversation restore is not available for this checkpoint.', 'error')
          return
        }
        onRestoreConversation(selectedEntry.turnId)
        onDone(`restored conversation to before: ${selectedEntry.checkpointLabel}`, 'dim')
        return
      }

      const result = await rewindWorkspaceEditsByEntryIds(cwd, [selectedEntry.id])
      if (result.reverted === 0) {
        onDone('no matching rewind entry was found.', 'error')
        return
      }

      if (action === 'both') {
        if (!selectedEntry.turnId || !canRestoreConversation) {
          onDone('conversation restore is not available for this checkpoint.', 'error')
          return
        }
        onRestoreConversation(selectedEntry.turnId)
      }

      const fileList = result.files.map(file => file.split(/[\\/]/).at(-1) ?? file).join(', ')
      const prefix = action === 'both' ? 'restored code and conversation' : 'restored code'
      onDone(`${prefix}: ${fileList}`, 'dim')
    } catch (err: unknown) {
      onDone(`rewind failed: ${(err as Error).message}`, 'error')
    }
  }

  const loadMoreEntries = async () => {
    if (state.kind !== 'ready' || !state.hasMore || state.restoring) return
    try {
      const nextEntries = await listRewindEntries(cwd, { limit: state.pageSize, offset: state.offset })
      setState(prev => {
        if (prev.kind !== 'ready') return prev
        const merged = dedupeEntryIds([...prev.entries, ...nextEntries])
        const selectedFilePath = prev.selectedFilePath ?? merged[0]?.filePath ?? null
        const selectedId =
          prev.selectedId && merged.some(entry => entry.id === prev.selectedId)
            ? prev.selectedId
            : merged.find(entry => entry.filePath === selectedFilePath)?.id ?? merged[0]?.id ?? null
        return {
          ...prev,
          entries: merged,
          offset: prev.offset + nextEntries.length,
          hasMore: nextEntries.length === prev.pageSize,
          selectedFilePath,
          selectedId,
        }
      })
    } catch (err: unknown) {
      onDone(`failed to load older checkpoints: ${(err as Error).message}`, 'error')
    }
  }

  const handleCancel = () => {
    if (state.stage === 'actions') {
      setState(prev => prev.kind === 'ready' ? { ...prev, stage: 'entries' } : prev)
      return
    }
    if (state.stage === 'entries') {
      setState(prev => prev.kind === 'ready' ? { ...prev, stage: 'files' } : prev)
      return
    }
    onCancel()
  }

  return (
      <Surface
        title="Rewind"
        subtitle={buildSubtitle(state.stage, selectedEntry.relativePath)}
      footer={buildFooter(state.stage, state.restoring)}
    >
      {state.stage === 'files' ? (
        <>
          <Select
            options={buildFileOptions(fileEntries, state.hasMore)}
            onSubmit={filePath => {
              if (filePath === LOAD_MORE_VALUE) {
                void loadMoreEntries()
                return
              }
              const firstEntry = state.entries.find(entry => entry.filePath === filePath) ?? null
              setState(prev => prev.kind === 'ready'
                ? {
                    ...prev,
                    selectedFilePath: filePath,
                    selectedId: firstEntry?.id ?? null,
                    stage: 'entries',
                  }
                : prev)
            }}
            onCancel={handleCancel}
            onHighlight={value => {
              if (value === LOAD_MORE_VALUE) return
              setState(prev => prev.kind === 'ready'
                ? {
                    ...prev,
                    selectedFilePath: value,
                    selectedId: prev.entries.find(entry => entry.filePath === value)?.id ?? null,
                  }
                : prev)
            }}
          />
          <CompactPreview entry={selectedFile} />
        </>
      ) : state.stage === 'entries' ? (
        <>
          <Select
            options={buildEntryOptions(scopedEntries, state.hasMore)}
            onSubmit={entryId => {
              if (entryId === LOAD_MORE_VALUE) {
                void loadMoreEntries()
                return
              }
              setState(prev => prev.kind === 'ready'
                ? { ...prev, selectedId: entryId, stage: 'actions' }
                : prev)
            }}
            onCancel={handleCancel}
            onHighlight={value => {
              if (value === LOAD_MORE_VALUE) return
              setState(prev => prev.kind === 'ready'
                ? { ...prev, selectedId: value }
                : prev)
            }}
          />
          <CompactPreview entry={selectedEntry} />
        </>
      ) : (
        <>
          <Select
            options={buildActionOptions(canRestoreConversation)}
            onSubmit={value => { void executeRestore(value) }}
            onCancel={handleCancel}
            onHighlight={value => setState(prev => prev.kind === 'ready'
              ? { ...prev, selectedAction: value }
              : prev)}
          />
          <ActionPreview entry={selectedEntry} selectedAction={state.selectedAction} canRestoreConversation={canRestoreConversation} />
        </>
      )}
    </Surface>
  )
}

const LOAD_MORE_VALUE = '__load_more__'

function buildFileOptions(entries: RewindEntry[], hasMore: boolean): Array<SelectOption<string>> {
  const options = entries.map(entry => ({
    value: entry.filePath,
    label: entry.relativePath,
    hint: formatTimestamp(entry.createdAt),
  }))
  if (hasMore) {
    options.push({
      value: LOAD_MORE_VALUE,
      label: 'show older checkpoints',
      hint: 'load more file history from this directory',
    })
  }
  return options
}

function buildEntryOptions(entries: RewindEntry[], hasMore: boolean): Array<SelectOption<string>> {
  const options = entries.map(entry => ({
    value: entry.id,
    label: entry.checkpointLabel || 'checkpoint',
    hint: `${formatTimestamp(entry.createdAt)} - ${entry.changeSummary}`,
  }))
  if (hasMore) {
    options.push({
      value: LOAD_MORE_VALUE,
      label: 'show older checkpoints',
      hint: 'load more checkpoints for this directory',
    })
  }
  return options
}

function buildActionOptions(canRestoreConversation: boolean): Array<SelectOption<RestoreAction>> {
  const options: Array<SelectOption<RestoreAction>> = []
  if (canRestoreConversation) {
    options.push({ value: 'both', label: 'restore code and conversation', hint: 'full rewind' })
    options.push({ value: 'conversation', label: 'restore conversation only', hint: 'keep current files unchanged' })
  }
  options.push({ value: 'code', label: 'restore code only', hint: 'revert the selected file checkpoint only' })
  return options
}

const CompactPreview: React.FC<{ entry: RewindEntry }> = ({ entry }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text color={theme.accentPrimary}>{entry.relativePath}</Text>
    <Text color={theme.dim}>{entry.promptSnippet || '(prompt snippet unavailable for older checkpoints)'}</Text>
  </Box>
)

const ActionPreview: React.FC<{
  entry: RewindEntry
  selectedAction: RestoreAction
  canRestoreConversation: boolean
}> = ({ entry, selectedAction, canRestoreConversation }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text color={theme.accentPrimary}>{entry.relativePath}</Text>
    <Text color={theme.dim}>{formatTimestamp(entry.createdAt)} - {entry.changeSummary}</Text>
    <Text color={theme.textSubtle}>
      {selectedAction === 'both'
        ? 'restore the selected file checkpoint and roll the current conversation back to before this prompt.'
        : selectedAction === 'conversation'
          ? 'restore only the conversation state to before this prompt.'
          : 'restore only the selected file checkpoint.'}
    </Text>
    {!canRestoreConversation ? (
      <Text color={theme.dim}>Conversation restore is only available for checkpoints from the current session.</Text>
    ) : null}
    <Text color={theme.textSubtle}>{previewContent(entry.previousContent)}</Text>
  </Box>
)

function dedupeFiles(entries: RewindEntry[]): RewindEntry[] {
  const seen = new Set<string>()
  const out: RewindEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.filePath)) continue
    seen.add(entry.filePath)
    out.push(entry)
  }
  return out
}

function dedupeEntryIds(entries: RewindEntry[]): RewindEntry[] {
  const seen = new Set<string>()
  const out: RewindEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

function previewContent(text: string): string {
  if (!text.trim()) return '(empty before this edit)'
  const normalized = text.replace(/\s+$/g, '')
  return normalized.length <= 140 ? normalized : `${normalized.slice(0, 137)}...`
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function buildSubtitle(stage: ReadyState['stage'], relativePath: string): string {
  if (stage === 'files') return 'choose a file with saved checkpoints.'
  if (stage === 'entries') return `checkpoints for ${relativePath}`
  return `choose how to restore ${relativePath}`
}

function buildFooter(stage: ReadyState['stage'], restoring: boolean): string {
  if (restoring) return 'restoring...'
  if (stage === 'files') return 'enter selects a file · esc closes'
  if (stage === 'entries') return 'enter chooses a checkpoint · esc back'
  return 'enter restores · esc back'
}
