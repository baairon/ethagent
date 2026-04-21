import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { Surface } from './Surface.js'
import { listSessions, type SessionSummary } from '../storage/sessions.js'

type ResumeViewProps = {
  currentSessionId: string
  onResume: (sessionId: string) => void
  onCancel: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; sessions: SessionSummary[] }

export const ResumeView: React.FC<ResumeViewProps> = ({ currentSessionId, onResume, onCancel }) => {
  const [state, setState] = useState<State>({ kind: 'loading' })

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
      <Surface title="Resume Session" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.sessions.length === 0) {
    return (
      <Surface title="Resume Session" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>No prior sessions to resume.</Text>
      </Surface>
    )
  }

  const options = buildResumeOptions(state.sessions, currentSessionId)

  return (
    <Surface
      title="Resume Session"
      subtitle="Grouped by project, then working directory."
      footer="Enter resumes. Esc closes."
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text color={theme.dim}>Recent projects</Text>
      </Box>
      <Select
        options={options}
        initialIndex={findInitialIndex(options, currentSessionId)}
        maxVisible={14}
        onSubmit={onResume}
        onCancel={onCancel}
      />
    </Surface>
  )
}

function buildResumeOptions(
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
      const label = session.id === currentSessionId ? `${baseLabel}  (current)` : baseLabel
      options.push({
        value: session.id,
        label,
        hint: `${session.turnCount} turn${session.turnCount === 1 ? '' : 's'} · ${formatRelative(session.mtimeMs)}`,
      })
    }
  }

  return options
}

function findInitialIndex(options: Array<SelectOption<string>>, currentSessionId: string): number {
  const currentIndex = options.findIndex(option => option.value === currentSessionId)
  if (currentIndex >= 0) return currentIndex
  return Math.max(0, options.findIndex(option => !option.disabled))
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
