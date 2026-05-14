import React, { useEffect, useState } from 'react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import { Spinner } from '../../ui/Spinner.js'
import { theme } from '../../ui/theme.js'
import { useAppInput } from '../../app/input/AppInputProvider.js'
import {
  groupRewindEntriesByTurn,
  rewindWorkspaceEditsByEntryIds,
  type RewindEntry,
} from '../../storage/rewind.js'
import { loadSession } from '../../storage/sessions.js'
import { computeLineDiffStats } from '../../tools/fileDiff.js'

type RestoreAction = 'both' | 'conversation' | 'code' | 'summarize'
type ConfirmOption = RestoreAction | 'nevermind'

type RewindViewProps = {
  cwd: string
  currentSessionId: string
  onRestoreConversation: (turnId: string, promptText?: string) => void
  onSummarizeFromTurn: (turnId: string) => void | Promise<unknown>
  onDone: (message: string, variant?: 'info' | 'error' | 'dim') => void
  onCancel: () => void
}

type DiffStats = {
  files: string[]
  inserts: number
  deletes: number
}

type PromptRow = {
  turnId: string
  text: string
  createdAt: string
  entries: RewindEntry[]
  stats: DiffStats
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'picker' }
  | { kind: 'confirm'; turnId: string; selectedAction: ConfirmOption }
  | { kind: 'restoring' }

export const RewindView: React.FC<RewindViewProps> = ({
  cwd,
  currentSessionId,
  onRestoreConversation,
  onSummarizeFromTurn,
  onDone,
  onCancel,
}) => {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [rows, setRows] = useState<PromptRow[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [sessionMessages, grouped] = await Promise.all([
          loadSession(currentSessionId),
          groupRewindEntriesByTurn(cwd, currentSessionId),
        ])
        const prompts: PromptRow[] = []
        for (const msg of sessionMessages) {
          if (msg.role !== 'user') continue
          if (msg.synthetic) continue
          if (!msg.turnId) continue
          const entries = grouped.get(msg.turnId) ?? []
          const stats = await computeDiffStatsForEntries(entries)
          prompts.push({
            turnId: msg.turnId,
            text: msg.content,
            createdAt: msg.createdAt,
            entries,
            stats,
          })
        }
        if (cancelled) return
        setRows(prompts)
        setState({ kind: 'picker' })
      } catch (err: unknown) {
        if (cancelled) return
        setState({ kind: 'error', message: (err as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [cwd, currentSessionId])

  const escActive =
    state.kind === 'loading' ||
    state.kind === 'error' ||
    (state.kind === 'picker' && rows.length === 0)
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
  }, { isActive: escActive })

  if (state.kind === 'loading') {
    return (
      <Surface title="Rewind" subtitle="Loading session history...">
        <Spinner label="Loading rewind history..." />
      </Surface>
    )
  }

  if (state.kind === 'error') {
    return (
      <Surface title="Rewind" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.kind === 'restoring') {
    return (
      <Surface title="Rewind" subtitle="Restoring..." footer="Restoring...">
        <Spinner label="Restoring..." />
      </Surface>
    )
  }

  if (rows.length === 0) {
    return (
      <Surface title="Rewind" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>Nothing to rewind to yet.</Text>
      </Surface>
    )
  }

  if (state.kind === 'confirm') {
    const selectedRow = rows.find(row => row.turnId === state.turnId)
    if (!selectedRow) {
      setState({ kind: 'picker' })
      return null
    }
    const canRestoreCode = selectedRow.entries.length > 0

    const actionOptions: Array<SelectOption<ConfirmOption>> = [
      { value: 'both', role: 'section', label: 'Restore' },
      { value: 'both', prefix: '1.', label: 'Restore code and conversation', disabled: !canRestoreCode },
      { value: 'conversation', prefix: '2.', label: 'Restore conversation' },
      { value: 'code', prefix: '3.', label: 'Restore code', disabled: !canRestoreCode },
      { value: 'summarize', prefix: '4.', label: 'Summarize from here' },
      { value: 'nevermind', role: 'section', label: 'Navigation' },
      { value: 'nevermind', prefix: '5.', label: 'Never mind', role: 'utility' },
    ]
    const defaultValue: ConfirmOption = canRestoreCode ? 'both' : 'conversation'
    const initialIndex = actionOptions.findIndex(option => option.value === defaultValue && !option.disabled)

    const runRestore = async (action: RestoreAction) => {
      if (action === 'summarize') {
        try {
          await onSummarizeFromTurn(state.turnId)
          onDone('Summarizing the conversation from this point...', 'dim')
        } catch (err: unknown) {
          onDone(`Summarize failed: ${(err as Error).message}`, 'error')
        }
        return
      }
      setState({ kind: 'restoring' })
      const codeIds = selectedRow.entries.map(entry => entry.id)
      let codeError: Error | null = null
      let codeFiles: string[] = []
      let conversationError: Error | null = null

      if (action === 'code' || action === 'both') {
        try {
          const result = await rewindWorkspaceEditsByEntryIds(cwd, codeIds)
          codeFiles = result.files
          if (result.reverted === 0) {
            codeError = new Error('No matching rewind entries were found for this prompt.')
          }
        } catch (err: unknown) {
          codeError = err as Error
        }
      }
      if (action === 'conversation' || action === 'both') {
        try {
          onRestoreConversation(state.turnId, selectedRow.text)
        } catch (err: unknown) {
          conversationError = err as Error
        }
      }

      if (codeError && conversationError) {
        onDone(`Rewind failed: ${codeError.message}; ${conversationError.message}`, 'error')
        return
      }
      if (codeError) {
        onDone(`Code restore failed: ${codeError.message}`, 'error')
        return
      }
      if (conversationError) {
        onDone(`Conversation restore failed: ${conversationError.message}`, 'error')
        return
      }

      if (action === 'both') {
        const files = describeFileList(codeFiles, cwd)
        onDone(`Restored code and conversation to before this prompt.${files ? ` Files: ${files}.` : ''}`, 'dim')
      } else if (action === 'code') {
        const files = describeFileList(codeFiles, cwd)
        onDone(`Restored code to before this prompt.${files ? ` Files: ${files}.` : ''}`, 'dim')
      } else {
        onDone('Restored conversation to before this prompt.', 'dim')
      }
    }

    return (
      <Surface
        title="Rewind"
        subtitle="Confirm you want to restore to the point before you sent this message."
        footer="Enter to restore. Esc to go back."
      >
        <Box flexDirection="column">
          <Text color={theme.accentPeriwinkle}>{truncate(selectedRow.text, 280)}</Text>
          <Text color={theme.dim}>
            {formatTimestamp(selectedRow.createdAt)}
            {describeStats(selectedRow.stats, cwd) ? ` · ${describeStats(selectedRow.stats, cwd)}` : ''}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Select
            options={actionOptions}
            initialIndex={initialIndex < 0 ? 1 : initialIndex}
            onSubmit={value => {
              if (value === 'nevermind') {
                setState({ kind: 'picker' })
                return
              }
              void runRestore(value)
            }}
            onCancel={() => setState({ kind: 'picker' })}
            onHighlight={value => {
              setState(prev => prev.kind === 'confirm'
                ? { ...prev, selectedAction: value }
                : prev)
            }}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <ConfirmDescription
            action={state.selectedAction}
            stats={selectedRow.stats}
            cwd={cwd}
            canRestoreCode={canRestoreCode}
          />
        </Box>
      </Surface>
    )
  }

  const pickerOptions = buildPickerOptions(rows, cwd)
  const lastIndex = Math.max(0, rows.length - 1)

  return (
    <Surface
      title="Rewind"
      subtitle="Restore the code and/or conversation to the point before a prior prompt."
      footer="Enter to continue. Esc to exit."
    >
      <Select
        options={pickerOptions}
        initialIndex={lastIndex}
        maxVisible={7}
        onSubmit={turnId => {
          const row = rows.find(r => r.turnId === turnId)
          const canRestoreCode = (row?.entries.length ?? 0) > 0
          setState({
            kind: 'confirm',
            turnId,
            selectedAction: canRestoreCode ? 'both' : 'conversation',
          })
        }}
        onCancel={onCancel}
      />
    </Surface>
  )
}

const ConfirmDescription: React.FC<{
  action: ConfirmOption
  stats: DiffStats
  cwd: string
  canRestoreCode: boolean
}> = ({ action, stats, cwd, canRestoreCode }) => {
  if (action === 'nevermind') {
    return <Text color={theme.textSubtle}>The conversation and code will be unchanged.</Text>
  }
  if (action === 'summarize') {
    return (
      <Text color={theme.textSubtle}>
        Messages from this point forward will be summarized into a handoff. The earlier conversation will remain unchanged.
      </Text>
    )
  }
  const lines: React.ReactNode[] = []
  if (action === 'both') {
    lines.push(<Text key="0" color={theme.textSubtle}>The conversation will be forked.</Text>)
    lines.push(<CodeRestoreLine key="1" stats={stats} cwd={cwd} canRestoreCode={canRestoreCode} />)
  } else if (action === 'conversation') {
    lines.push(<Text key="0" color={theme.textSubtle}>The conversation will be forked.</Text>)
    lines.push(<Text key="1" color={theme.textSubtle}>The code will be unchanged.</Text>)
  } else {
    lines.push(<Text key="0" color={theme.textSubtle}>The conversation will be unchanged.</Text>)
    lines.push(<CodeRestoreLine key="1" stats={stats} cwd={cwd} canRestoreCode={canRestoreCode} />)
  }
  if ((action === 'code' || action === 'both') && canRestoreCode) {
    lines.push(
      <Text key="footnote" color={theme.dim}>
        Rewinding does not affect files edited manually or via bash.
      </Text>,
    )
  }
  return <>{lines}</>
}

const CodeRestoreLine: React.FC<{ stats: DiffStats; cwd: string; canRestoreCode: boolean }> = ({ stats, cwd, canRestoreCode }) => {
  if (!canRestoreCode) {
    return <Text color={theme.textSubtle}>The code has not changed (nothing will be restored).</Text>
  }
  if (stats.inserts === 0 && stats.deletes === 0) {
    return <Text color={theme.textSubtle}>The code will be restored in {describeFiles(stats.files, cwd)}.</Text>
  }
  return (
    <Text color={theme.textSubtle}>
      The code will be restored{' '}
      <Text color={theme.diffAdded}>+{stats.inserts} </Text>
      <Text color={theme.diffRemoved}>-{stats.deletes}</Text>
      {' '}in {describeFiles(stats.files, cwd)}.
    </Text>
  )
}

function buildPickerOptions(rows: PromptRow[], cwd: string): Array<SelectOption<string>> {
  return rows.map(row => ({
    value: row.turnId,
    label: truncate(row.text, 80),
    subtext: describeStats(row.stats, cwd) || 'No code changes',
    hint: formatTimestamp(row.createdAt),
  }))
}

async function computeDiffStatsForEntries(entries: RewindEntry[]): Promise<DiffStats> {
  const files: string[] = []
  const seen = new Set<string>()
  let inserts = 0
  let deletes = 0
  for (const entry of entries) {
    if (!seen.has(entry.filePath)) {
      seen.add(entry.filePath)
      files.push(entry.filePath)
    }
    let currentContent = ''
    try {
      currentContent = await fs.readFile(entry.filePath, 'utf8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const stats = computeLineDiffStats(entry.previousContent, currentContent)
    inserts += stats.inserts
    deletes += stats.deletes
  }
  return { files, inserts, deletes }
}

function describeStats(stats: DiffStats, cwd: string): string {
  if (stats.files.length === 0) return ''
  const fileLabel = describeFiles(stats.files, cwd)
  if (stats.inserts === 0 && stats.deletes === 0) return fileLabel
  return `${fileLabel} +${stats.inserts} -${stats.deletes}`
}

function describeFiles(files: string[], cwd: string): string {
  if (files.length === 0) return ''
  const formatted = files.map(file => formatRelative(file, cwd))
  if (formatted.length === 1) return formatted[0]!
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`
  return `${formatted[0]} and ${formatted.length - 1} other files`
}

function describeFileList(files: string[], cwd: string): string {
  if (files.length === 0) return ''
  return files.map(file => formatRelative(file, cwd)).join(', ')
}

function formatRelative(filePath: string, cwd: string): string {
  try {
    const rel = path.relative(cwd, filePath)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
  } catch {
    return path.basename(filePath)
  }
  return path.basename(filePath)
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`
}
