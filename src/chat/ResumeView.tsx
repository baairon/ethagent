import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../ui/theme.js'
import { Select, type SelectOption } from '../ui/Select.js'
import { Spinner } from '../ui/Spinner.js'
import { Surface } from '../ui/Surface.js'
import { listSessions, type SessionSummary } from '../storage/sessions.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

type ResumeViewProps = {
  currentSessionId: string
  onResume: (sessionId: string) => void
  onClearAll: () => void | Promise<void>
  onCancel: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; sessions: SessionSummary[] }
  | { kind: 'confirmClear'; sessions: SessionSummary[]; error?: string }
  | { kind: 'clearing'; sessions: SessionSummary[] }

export const CLEAR_ALL_SESSIONS_VALUE = '__clear_all_sessions__'

export const ResumeView: React.FC<ResumeViewProps> = ({ currentSessionId, onResume, onClearAll, onCancel }) => {
  const [state, setState] = useState<State>({ kind: 'loading' })

  // Allow ESC to close the view during loading / error states
  // (Select handles ESC only when it's rendered in the 'ready' state)
  const escActive = state.kind === 'loading' || state.kind === 'error' || (state.kind === 'ready' && state.sessions.length === 0)
  useAppInput((_input, key) => {
    if (key.escape) onCancel()
  }, { isActive: escActive })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const all = await listSessions(50)
        if (cancelled) return
        setState({ kind: 'ready', sessions: all })
      } catch (err: unknown) {
        if (cancelled) return
        setState({ kind: 'error', message: (err as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [currentSessionId])

  if (state.kind === 'loading') {
    return (
      <Surface title="Resume Session" subtitle="Loading projects and directories...">
        <Spinner label="loading sessions..." />
      </Surface>
    )
  }

  if (state.kind === 'error') {
    return (
      <Surface title="Resume Session" tone="muted" footer="esc closes">
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.kind === 'confirmClear') {
    return (
      <Surface
        title="Clear All Chat Logs?"
        subtitle={`${state.sessions.length} saved session${state.sessions.length === 1 ? '' : 's'} will be removed.`}
        tone="error"
        footer="enter selects · esc returns to resume"
      >
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>Removes saved chats and resume context from this machine.</Text>
          <Text color={theme.dim}>Config, identities, keys, and local models stay.</Text>
          {state.error ? <Text color="#e87070">{state.error}</Text> : null}
        </Box>
        <Select<'back' | 'clear'>
          options={[
            { value: 'back', label: 'back to sessions' },
            { value: 'clear', label: 'clear all chat logs', hint: 'cannot be undone' },
          ]}
          onSubmit={choice => {
            if (choice === 'back') {
              setState({ kind: 'ready', sessions: state.sessions })
              return
            }
            void clearAll(state.sessions, onClearAll, setState)
          }}
          onCancel={() => setState({ kind: 'ready', sessions: state.sessions })}
        />
      </Surface>
    )
  }

  if (state.kind === 'clearing') {
    return (
      <Surface title="Clearing Chat Logs" subtitle="Removing saved chats and resume context.">
        <Spinner label="clearing sessions..." />
      </Surface>
    )
  }

  if (state.sessions.length === 0) {
    return (
      <Surface title="Resume Session" tone="muted" footer="esc closes">
        <Text color={theme.dim}>No prior sessions to resume.</Text>
      </Surface>
    )
  }

  const options = buildResumeOptions(state.sessions, currentSessionId)

  return (
    <Surface
      title="Resume Session"
      subtitle="Grouped by project, then working directory."
      footer="enter resumes · esc closes"
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim}>Recent projects</Text>
      </Box>
      <Select
        options={options}
        initialIndex={findInitialIndex(options, currentSessionId)}
        maxVisible={14}
        onSubmit={value => {
          if (value === CLEAR_ALL_SESSIONS_VALUE) {
            setState({ kind: 'confirmClear', sessions: state.sessions })
            return
          }
          onResume(value)
        }}
        onCancel={onCancel}
      />
    </Surface>
  )
}

export function buildResumeOptions(
  sessions: SessionSummary[],
  currentSessionId: string,
): Array<SelectOption<string>> {
  const groups = new Map<string, SessionSummary[]>()
  for (const session of sessions) {
    const key = session.projectRoot
    const existing = groups.get(key) ?? []
    existing.push(session)
    groups.set(key, existing)
  }

  const options: Array<SelectOption<string>> = []
  const manageSpacer: SelectOption<string> = {
    value: 'separator:spacer',
    label: '',
    disabled: true,
  }

  const clearOption: SelectOption<string> = {
    value: CLEAR_ALL_SESSIONS_VALUE,
    label: 'clear all chat logs',
    hint: 'removes saved chats and resume context',
    role: 'utility',
  }

  const orderedGroups = [...groups.values()].sort((left, right) => right[0]!.mtimeMs - left[0]!.mtimeMs)

  for (const group of orderedGroups) {
    const head = group[0]!
    options.push({
      value: `header:${head.projectRoot}`,
      label: head.projectLabel,
      hint: compressProjectPath(head.projectRoot),
      disabled: true,
    })

    const byDirectory = [...group].sort((left, right) => right.mtimeMs - left.mtimeMs)
    let lastDirectoryLabel: string | null = null

    for (const session of byDirectory) {
      if (session.directoryLabel !== lastDirectoryLabel) {
        lastDirectoryLabel = session.directoryLabel
        options.push({
          value: `directory:${head.projectRoot}:${session.directoryLabel}`,
          label: `in ${formatDirectoryDisplay(session.directoryLabel)}`,
          hint: undefined,
          disabled: true,
        })
      }

      const baseLabel = formatFirstLine(session.firstUserMessage) || '(empty session)'
      const markers = [
        session.id === currentSessionId ? 'current' : '',
      ].filter(Boolean)
      const label = markers.length > 0 ? `${baseLabel}  (${markers.join(', ')})` : baseLabel
      const summaryHint = session.compactedFromSessionId
        ? `summary from ${session.compactedFromSessionId.slice(0, 8)}`
        : null
      const hintParts = [
        `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'}`,
        formatRelative(session.mtimeMs),
        session.id.slice(0, 8),
        summaryHint,
      ].filter(Boolean)
      options.push({
        value: session.id,
        label,
        hint: hintParts.join(' · '),
      })
    }
  }

  // Utility section sits below all session groups with a visual gap
  options.push(manageSpacer)
  options.push(clearOption)

  return options
}

function findInitialIndex(options: Array<SelectOption<string>>, currentSessionId: string): number {
  const currentIndex = options.findIndex(option => option.value === currentSessionId)
  if (currentIndex >= 0) return currentIndex
  return Math.max(0, options.findIndex(option => !option.disabled && option.value !== CLEAR_ALL_SESSIONS_VALUE))
}

async function clearAll(
  sessions: SessionSummary[],
  onClearAll: () => void | Promise<void>,
  setState: (state: State) => void,
): Promise<void> {
  setState({ kind: 'clearing', sessions })
  try {
    await onClearAll()
  } catch (err: unknown) {
    setState({ kind: 'confirmClear', sessions, error: (err as Error).message })
  }
}

function compressProjectPath(input: string): string {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return home && input.startsWith(home) ? `~${input.slice(home.length)}` : input
}

function formatDirectoryDisplay(input: string): string {
  if (input === '.' || input === '') return './'
  return input.startsWith('./') ? input : `./${input}`
}

function formatFirstLine(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  if (firstLine.length <= 56) return firstLine
  return `${firstLine.slice(0, 53)}...`
}

function formatRelative(ms: number): string {
  const diffMs = Date.now() - ms
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toISOString().slice(0, 10)
}
