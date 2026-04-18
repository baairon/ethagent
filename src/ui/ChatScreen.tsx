import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import { compressHome } from '../utils/path.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Provider, Message } from '../providers/contracts.js'
import type { PullProgress } from '../bootstrap/ollama.js'
import { createProvider } from '../providers/registry.js'
import { buildSystemPrompt } from '../core/systemPrompt.js'
import { systemMessage, approximateTokens } from '../core/messages.js'
import { runTurn } from '../core/chatLoop.js'
import {
  dispatchSlash,
  parseSlash,
  getSlashSuggestions,
  type SlashContext,
} from '../core/commands.js'
import { theme } from './theme.js'
import { BrandSplash } from './BrandSplash.js'
import { SessionStatus } from './SessionStatus.js'
import { ChatInput } from './ChatInput.js'
import { MessageList, type MessageRow } from './MessageList.js'
import { Spinner } from './Spinner.js'
import { ModelPicker, type ModelPickerSelection } from './ModelPicker.js'
import { ResumeView } from './ResumeView.js'
import { CopyPicker } from './CopyPicker.js'
import type { CopyResult } from '../utils/clipboard.js'
import { useKeybinding, useRegisterKeybindingContext } from '../keybindings/KeybindingProvider.js'
import { useCancelRequest } from '../hooks/useCancelRequest.js'
import { useExitOnCtrlC } from '../hooks/useExitOnCtrlC.js'
import {
  appendSessionMessage,
  loadSession,
  newSessionId,
} from '../storage/sessions.js'
import type { SessionMessage } from '../storage/sessions.js'
import { appendHistory, readHistory } from '../storage/history.js'
import {
  compactTranscript,
  shouldAutoCompact,
  truncateFallback,
} from '../core/compaction.js'
import { defaultBaseUrlFor, saveConfig } from '../storage/config.js'

type ChatScreenProps = {
  config: EthagentConfig
  onReplaceConfig?: (next: EthagentConfig) => void
}

type SessionMode = 'chat' | 'plan' | 'accept-edits'
type Overlay = 'none' | 'modelPicker' | 'resume' | 'copyPicker'

type CopyPickerState = { turnText: string; turnLabel: string } | null

let rowIdSeq = 0
const nextRowId = (): string => `row-${++rowIdSeq}`
const nowIso = (): string => new Date().toISOString()

export const ChatScreen: React.FC<ChatScreenProps> = ({ config: initialConfig, onReplaceConfig }) => {
  useRegisterKeybindingContext('Chat')
  const { exit } = useApp()
  const [config, setConfig] = useState<EthagentConfig>(initialConfig)
  const [rows, setRows] = useState<MessageRow[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [turns, setTurns] = useState(0)
  const [approxTokens, setApproxTokens] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [copyPickerState, setCopyPickerState] = useState<CopyPickerState>(null)
  const [mode, setMode] = useState<SessionMode>('chat')
  const [sessionId, setSessionId] = useState<string>(() => newSessionId())
  const [sessionKey, setSessionKey] = useState<number>(0)
  const [, setTick] = useState(0)
  const startedAt = useRef(Date.now()).current

  const rowsRef = useRef<MessageRow[]>([])
  const sessionMessagesRef = useRef<SessionMessage[]>([])
  const sessionIdRef = useRef<string>(sessionId)
  const streamAbortRef = useRef<AbortController | null>(null)
  const pullsRef = useRef<Map<string, AbortController>>(new Map())
  const providerRef = useRef<Provider>(createProvider(initialConfig))
  const configRef = useRef<EthagentConfig>(initialConfig)
  const prevConfigRef = useRef<EthagentConfig>(initialConfig)
  const compactingRef = useRef<boolean>(false)

  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  useEffect(() => {
    if (prevConfigRef.current === config) return
    prevConfigRef.current = config
    configRef.current = config
    providerRef.current = createProvider(config)
  }, [config])

  useEffect(() => {
    void (async () => {
      const loaded = await readHistory()
      setHistory(loaded)
    })()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort()
      for (const controller of pullsRef.current.values()) controller.abort()
      pullsRef.current.clear()
    }
  }, [])

  const pushNote = useCallback(
    (text: string, kind: 'info' | 'error' | 'dim' = 'info') => {
      setRows(prev => [...prev, { role: 'note', id: nextRowId(), kind, content: text }])
    },
    [],
  )

  const replaceConfig = useCallback(
    (next: EthagentConfig) => {
      setConfig(next)
      onReplaceConfig?.(next)
    },
    [onReplaceConfig],
  )

  const clearTranscript = useCallback(() => {
    setRows([])
    setTurns(0)
    setApproxTokens(0)
    sessionMessagesRef.current = []
    setSessionId(newSessionId())
    setSessionKey(k => k + 1)
  }, [])

  const doExit = useCallback(() => {
    streamAbortRef.current?.abort()
    for (const controller of pullsRef.current.values()) controller.abort()
    pullsRef.current.clear()
    exit()
  }, [exit])

  const persistSessionMessage = useCallback(
    async (msg: SessionMessage) => {
      sessionMessagesRef.current = [...sessionMessagesRef.current, msg]
      try {
        await appendSessionMessage(sessionIdRef.current, msg)
      } catch {
      }
    },
    [],
  )

  const beginPull = useCallback((name: string): { progressId: string; signal: AbortSignal } => {
    const controller = new AbortController()
    const progressId = nextRowId()
    pullsRef.current.set(progressId, controller)
    setRows(prev => [
      ...prev,
      { role: 'progress', id: progressId, title: `pulling ${name}`, progress: 0, status: 'starting…' },
    ])
    return { progressId, signal: controller.signal }
  }, [])

  const updatePull = useCallback((progressId: string, event: PullProgress) => {
    setRows(prev =>
      prev.map(row => {
        if (row.id !== progressId || row.role !== 'progress') return row
        const progress =
          event.total && event.completed
            ? Math.max(0, Math.min(1, event.completed / event.total))
            : row.progress
        const suffix =
          event.total && event.completed
            ? `${formatBytes(event.completed)} / ${formatBytes(event.total)}`
            : row.suffix
        return { ...row, progress, status: event.status || row.status, suffix }
      }),
    )
  }, [])

  const finishPull = useCallback((progressId: string, model: string, error?: string) => {
    pullsRef.current.delete(progressId)
    setRows(prev => {
      const filtered = prev.filter(row => row.id !== progressId)
      const note: MessageRow = error
        ? {
            role: 'note',
            id: nextRowId(),
            kind: error === 'cancelled' ? 'dim' : 'error',
            content:
              error === 'cancelled'
                ? `pull cancelled: ${model}`
                : `pull failed: ${model} (${error})`,
          }
        : {
            role: 'note',
            id: nextRowId(),
            kind: 'info',
            content: `pulled ${model}. switch with /model ${model}`,
          }
      return [...filtered, note]
    })
  }, [])

  const reinstateFromMessages = useCallback((messages: Message[]) => {
    const nextRows: MessageRow[] = []
    for (const msg of messages) {
      if (msg.role === 'system') continue
      if (msg.role === 'user') {
        nextRows.push({ role: 'user', id: nextRowId(), content: msg.content })
      } else if (msg.role === 'assistant') {
        nextRows.push({ role: 'assistant', id: nextRowId(), content: msg.content })
      }
    }
    setRows(nextRows)
    setApproxTokens(approximateTokens(messages))
  }, [])

  const runCompaction = useCallback(
    async (reason: 'manual' | 'auto') => {
      if (compactingRef.current) return
      const priorMessages: Message[] = [systemMessage(buildSystemPrompt({
        cwd: process.cwd(),
        model: configRef.current.model,
        provider: configRef.current.provider,
        hasTools: false,
      }))]
      for (const row of rowsRef.current) {
        if (row.role === 'user') priorMessages.push({ role: 'user', content: row.content })
        else if (row.role === 'assistant' && row.content) {
          priorMessages.push({ role: 'assistant', content: row.content })
        }
      }
      if (priorMessages.length <= 5) {
        pushNote('not enough turns to compact yet.', 'dim')
        return
      }
      compactingRef.current = true
      pushNote(reason === 'auto' ? 'context filling up - compacting…' : 'compacting transcript…', 'dim')
      try {
        const result = await compactTranscript(providerRef.current, priorMessages)
        if (!result.ok) {
          const fallback = truncateFallback(priorMessages)
          reinstateFromMessages(fallback)
          pushNote(`compact failed (${result.reason}); trimmed transcript.`, 'dim')
        } else {
          reinstateFromMessages(result.compacted)
          pushNote('transcript compacted.', 'dim')
        }
      } catch (err: unknown) {
        pushNote(`compact error: ${(err as Error).message}`, 'error')
      } finally {
        compactingRef.current = false
      }
    },
    [pushNote, reinstateFromMessages],
  )

  const assistantTurns = useCallback((): string[] => {
    const out: string[] = []
    for (const row of rowsRef.current) {
      if (row.role === 'assistant' && row.content) out.push(row.content)
    }
    return out
  }, [])

  const buildSlashContext = useCallback(
    (): SlashContext => ({
      config: configRef.current,
      turns,
      approxTokens,
      startedAt,
      sessionId: sessionIdRef.current,
      sessionMessages: () => sessionMessagesRef.current,
      assistantTurns,
      onReplaceConfig: replaceConfig,
      onClear: clearTranscript,
      onExit: doExit,
      onResumeRequest: () => setOverlay('resume'),
      onCompactRequest: () => { void runCompaction('manual') },
      onCopyPickerRequest: (turnText, turnLabel) => {
        setCopyPickerState({ turnText, turnLabel })
        setOverlay('copyPicker')
      },
      onPullStart: beginPull,
      onPullProgress: updatePull,
      onPullDone: finishPull,
    }),
    [
      turns,
      approxTokens,
      startedAt,
      assistantTurns,
      replaceConfig,
      clearTranscript,
      doExit,
      runCompaction,
      beginPull,
      updatePull,
      finishPull,
    ],
  )

  const runStream = useCallback(
    async (userText: string) => {
      if (mode === 'accept-edits') {
        pushNote('accept-edits lights up once tools ship. staying in chat for this turn.', 'dim')
      } else if (mode === 'plan') {
        pushNote('plan mode: answering without touching the filesystem.', 'dim')
      }

      const controller = new AbortController()
      streamAbortRef.current = controller
      setStreaming(true)

      const userId = nextRowId()
      const assistantId = nextRowId()
      setRows(prev => [
        ...prev,
        { role: 'user', id: userId, content: userText },
        { role: 'assistant', id: assistantId, content: '', streaming: true },
      ])

      const priorMessages: Message[] = [systemMessage(buildSystemPrompt({
        cwd: process.cwd(),
        model: configRef.current.model,
        provider: configRef.current.provider,
        hasTools: false,
      }))]
      for (const row of rowsRef.current) {
        if (row.role === 'user') priorMessages.push({ role: 'user', content: row.content })
        else if (row.role === 'assistant' && row.content) {
          priorMessages.push({ role: 'assistant', content: row.content })
        }
      }
      priorMessages.push({ role: 'user', content: userText })

      await persistSessionMessage({ role: 'user', content: userText, createdAt: nowIso() })

      let accumulated = ''
      let thinkingContent = ''
      let thinkingRowId: string | null = null
      let errored = false
      try {
        for await (const ev of runTurn(providerRef.current, priorMessages, controller.signal)) {
          if (ev.type === 'text') {
            accumulated += ev.delta
            setRows(prev =>
              prev.map(r =>
                r.id === assistantId && r.role === 'assistant' ? { ...r, content: accumulated } : r,
              ),
            )
          } else if (ev.type === 'thinking') {
            thinkingContent += ev.delta
            if (thinkingRowId === null) {
              const newId = nextRowId()
              thinkingRowId = newId
              setRows(prev => {
                const idx = prev.findIndex(r => r.id === assistantId)
                const row: MessageRow = { role: 'thinking', id: newId, content: thinkingContent, streaming: true }
                if (idx === -1) return [...prev, row]
                return [...prev.slice(0, idx), row, ...prev.slice(idx)]
              })
            } else {
              const captured = thinkingRowId
              setRows(prev =>
                prev.map(r =>
                  r.id === captured && r.role === 'thinking'
                    ? { ...r, content: thinkingContent }
                    : r,
                ),
              )
            }
          } else if (ev.type === 'error') {
            errored = true
            pushNote(ev.message, 'error')
            break
          } else if (ev.type === 'cancelled') {
            break
          }
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          errored = true
          pushNote((err as Error).message || 'stream error', 'error')
        }
      }

      const cancelled = controller.signal.aborted
      setRows(prev =>
        prev.map(r => {
          if (r.id === assistantId && r.role === 'assistant') {
            return { ...r, content: accumulated || r.content, streaming: false }
          }
          if (thinkingRowId && r.id === thinkingRowId && r.role === 'thinking') {
            return { ...r, streaming: false }
          }
          return r
        }),
      )
      if (cancelled) pushNote('(cancelled)', 'dim')

      const finalMessages = [...priorMessages]
      if (accumulated && !errored) {
        finalMessages.push({ role: 'assistant', content: accumulated })
        await persistSessionMessage({
          role: 'assistant',
          content: accumulated,
          createdAt: nowIso(),
          model: configRef.current.model,
        })
      }
      setApproxTokens(approximateTokens(finalMessages))
      setTurns(t => t + 1)
      setStreaming(false)
      streamAbortRef.current = null

      if (!errored && !cancelled && shouldAutoCompact(finalMessages, configRef.current.model)) {
        void runCompaction('auto')
      }
    },
    [mode, pushNote, persistSessionMessage, runCompaction],
  )

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      setHistory(h => (h[h.length - 1] === value ? h : [...h, value]))
      void appendHistory(value)

      if (parseSlash(value)) {
        const ctx = buildSlashContext()
        const result = await dispatchSlash(value, ctx)
        if (result && result.kind === 'note') {
          pushNote(result.text, result.variant ?? 'info')
        }
        return
      }

      await runStream(value)
    },
    [buildSlashContext, pushNote, runStream],
  )

  const handleCancelStream = useCallback(() => {
    streamAbortRef.current?.abort()
  }, [])

  useCancelRequest({
    abortSignal: streaming ? streamAbortRef.current?.signal : undefined,
    onCancel: handleCancelStream,
    isActive: overlay === 'none',
  })

  const exitState = useExitOnCtrlC({
    isActive: overlay === 'none',
    onInterrupt: () => {
      if (streaming && streamAbortRef.current) {
        streamAbortRef.current.abort()
        return true
      }
      if (pullsRef.current.size > 0) {
        for (const controller of pullsRef.current.values()) controller.abort()
        return true
      }
      return false
    },
    onExit: doExit,
  })

  useKeybinding(
    'chat:modelPicker',
    () => { if (overlay === 'none') setOverlay('modelPicker') },
    { context: 'Chat', isActive: overlay === 'none' },
  )

  useKeybinding(
    'chat:cycleMode',
    () => {
      setMode(m => (m === 'chat' ? 'plan' : m === 'plan' ? 'accept-edits' : 'chat'))
    },
    { context: 'Chat', isActive: overlay === 'none' },
  )

  useKeybinding(
    'app:redraw',
    () => setTick(t => t + 1),
    { context: 'Global' },
  )

  const handleModelPick = useCallback(
    async (sel: ModelPickerSelection) => {
      setOverlay('none')
      if (sel.kind === 'ollama') {
        if (sel.model === configRef.current.model && configRef.current.provider === 'ollama') return
        const next: EthagentConfig = {
          ...configRef.current,
          provider: 'ollama',
          model: sel.model,
          baseUrl: configRef.current.baseUrl ?? defaultBaseUrlFor('ollama'),
        }
        try {
          await saveConfig(next)
          replaceConfig(next)
          pushNote(`now using ${sel.model}.`)
        } catch (err: unknown) {
          pushNote(`model switch failed: ${(err as Error).message}`, 'error')
        }
        return
      }
      const stayingOn = `${configRef.current.provider} · ${configRef.current.model}`
      const prefix = sel.keyJustSet ? `${sel.provider} key saved` : `${sel.provider} key ready`
      pushNote(`${prefix}. cloud provider support lands in the next release - staying on ${stayingOn}.`, 'dim')
    },
    [replaceConfig, pushNote],
  )

  const handleResumePick = useCallback(
    async (id: string) => {
      setOverlay('none')
      try {
        const loaded = await loadSession(id)
        if (loaded.length === 0) {
          pushNote('session was empty.', 'error')
          return
        }
        setSessionId(id)
        sessionMessagesRef.current = loaded
        const restored: MessageRow[] = []
        for (const msg of loaded) {
          if (msg.role === 'user') restored.push({ role: 'user', id: nextRowId(), content: msg.content })
          else if (msg.role === 'assistant') restored.push({ role: 'assistant', id: nextRowId(), content: msg.content })
        }
        restored.push({
          role: 'note',
          id: nextRowId(),
          kind: 'dim',
          content: `resumed from session ${id.slice(0, 8)}`,
        })
        setRows(restored)
        setTurns(loaded.filter(m => m.role === 'user').length)
        setSessionKey(k => k + 1)
      } catch (err: unknown) {
        pushNote(`resume failed: ${(err as Error).message}`, 'error')
      }
    },
    [pushNote],
  )

  const handleCopyDone = useCallback(
    (result: CopyResult, label: string) => {
      setOverlay('none')
      setCopyPickerState(null)
      if (result.ok) {
        pushNote(`copied ${label} via ${result.method}.`, 'dim')
      } else {
        pushNote(`copy failed: ${result.error}`, 'error')
      }
    },
    [pushNote],
  )

  const handleCopyCancel = useCallback(() => {
    setOverlay('none')
    setCopyPickerState(null)
    pushNote('copy cancelled.', 'dim')
  }, [pushNote])

  const pullInFlight = pullsRef.current.size > 0
  const busy = streaming || pullInFlight
  const slashSuggestions = useMemo(getSlashSuggestions, [])

  const contextLine = `${config.provider} · ${config.model} · ${compressHome(process.cwd())}`
  const tipLine = '/help for commands · ctrl+j for newline'

  const placeholderHints = useMemo(() => {
    if (streaming) return ['streaming… esc to cancel']
    if (pullInFlight) return ['pull in progress… ctrl+c to cancel']
    return []
  }, [streaming, pullInFlight])

  const modeLabel = mode === 'plan' ? 'plan mode' : mode === 'accept-edits' ? 'accept edits on' : ''
  const modeColor =
    mode === 'plan'
      ? theme.accentLavender
      : mode === 'accept-edits'
        ? theme.accentPeach
        : theme.accentMint
  const footerRight = (
    <Box flexDirection="row">
      {modeLabel ? (
        <>
          <Text color={modeColor}>{modeLabel}</Text>
          <Text color={theme.dim}> (</Text>
          <Text color={theme.accentMint}>shift+tab to cycle</Text>
          <Text color={theme.dim}>) · </Text>
        </>
      ) : (
        <>
          <Text color={theme.accentMint}>shift+tab to cycle</Text>
          <Text color={theme.dim}> · </Text>
        </>
      )}
      <Text color={theme.dim}>esc cancels · alt+p swap model</Text>
      {exitState.pending ? (
        <Text color={theme.accentPrimary}>  · press {exitState.keyName} again to exit</Text>
      ) : null}
    </Box>
  )

  return (
    <Box flexDirection="column" padding={1}>
      <BrandSplash key={`splash-${sessionKey}`} contextLine={contextLine} tipLine={tipLine} />
      <MessageList rows={rows} />
      {streaming ? (
        <Box marginTop={1}>
          <Spinner active hint={`${config.provider} · ${config.model}`} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        {overlay === 'modelPicker' ? (
          <ModelPicker
            currentProvider={config.provider}
            currentModel={config.model}
            onPick={handleModelPick}
            onCancel={() => setOverlay('none')}
          />
        ) : overlay === 'resume' ? (
          <ResumeView
            currentSessionId={sessionId}
            onResume={handleResumePick}
            onCancel={() => setOverlay('none')}
          />
        ) : overlay === 'copyPicker' && copyPickerState ? (
          <CopyPicker
            turnText={copyPickerState.turnText}
            turnLabel={copyPickerState.turnLabel}
            onDone={handleCopyDone}
            onCancel={handleCopyCancel}
          />
        ) : (
          <ChatInput
            onSubmit={handleSubmit}
            history={history}
            disabled={busy}
            placeholderHints={placeholderHints}
            slashSuggestions={slashSuggestions}
            footerRight={footerRight}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <SessionStatus
          provider={config.provider}
          model={config.model}
          turns={turns}
          approxTokens={approxTokens}
          elapsedMs={Date.now() - startedAt}
          streaming={streaming}
        />
      </Box>
    </Box>
  )
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0B'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(2)}GB`
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(0)}MB`
  const kb = bytes / 1024
  return `${kb.toFixed(0)}KB`
}

export default ChatScreen
