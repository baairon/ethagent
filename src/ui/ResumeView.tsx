import React, { useEffect, useState } from 'react'
import { Text } from 'ink'
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
        const all = await listSessions(20)
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
      <Surface
        title="Resume Session"
        subtitle="Pick a previous thread to reopen."
      >
        <Spinner label="loading sessions..." />
      </Surface>
    )
  }

  if (state.kind === 'error') {
    return (
      <Surface
        title="Resume Session"
        tone="muted"
        footer="Press Esc to close."
      >
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.sessions.length === 0) {
    return (
      <Surface
        title="Resume Session"
        tone="muted"
        footer="Press Esc to close."
      >
        <Text color={theme.dim}>No prior sessions to resume.</Text>
      </Surface>
    )
  }

  const options: SelectOption<string>[] = state.sessions.map(s => {
    const isCurrent = s.id === currentSessionId
    const baseLabel = formatFirstLine(s.firstUserMessage) || '(empty session)'
    const label = isCurrent ? `${baseLabel}  (current)` : baseLabel
    return {
      value: s.id,
      label,
      hint: `${s.turnCount} turn${s.turnCount === 1 ? '' : 's'} / ${formatRelative(s.mtimeMs)}`,
    }
  })

  return (
    <Surface
      title="Resume Session"
      subtitle="Recent sessions from local history."
      footer="Enter resumes. Esc closes."
    >
      <Select
        options={options}
        initialIndex={0}
        onSubmit={onResume}
        onCancel={onCancel}
      />
    </Surface>
  )
}

function formatFirstLine(text: string): string {
  const firstLine = text.split('\n', 1)[0] ?? ''
  if (firstLine.length <= 60) return firstLine
  return firstLine.slice(0, 57) + '...'
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


