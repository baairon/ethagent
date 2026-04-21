import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import { compressHome } from '../utils/path.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Provider, Message } from '../providers/contracts.js'
import type { PullProgress } from '../bootstrap/ollama.js'
import { createProvider } from '../providers/registry.js'
import { approximateTokens, messageTextContent } from '../core/messages.js'
import {
  dispatchSlash,
  parseSlash,
  getSlashSuggestions,
  type SlashContext,
} from '../core/commands.js'
import { theme } from './theme.js'
import { BrandSplash } from './BrandSplash.js'
import { SessionStatus } from './SessionStatus.js'
import { type MessageRow } from './MessageList.js'
import { ConversationStack } from './ConversationStack.js'
import { ModelPicker, type ModelPickerSelection } from './ModelPicker.js'
import type { CopyResult } from '../utils/clipboard.js'
import { useKeybinding, useRegisterKeybindingContext } from '../keybindings/KeybindingProvider.js'
import { useCancelRequest } from '../hooks/useCancelRequest.js'
import { useExitOnCtrlC } from '../hooks/useExitOnCtrlC.js'
import {
  appendSessionMessage,
  ensureSessionMetadata,
  loadSession,
  loadSessionMetadata,
  newSessionId,
  updateSessionActivity,
} from '../storage/sessions.js'
import type { SessionMessage } from '../storage/sessions.js'
import { loadPermissionRules, savePermissionRule } from '../storage/permissions.js'
import { appendHistory, readHistory } from '../storage/history.js'
import {
  compactTranscript,
  truncateFallback,
} from '../core/compaction.js'
import { defaultBaseUrlFor, defaultModelFor, saveConfig } from '../storage/config.js'
import { getCwd as getRuntimeCwd, setCwd as setRuntimeCwd, syncCwdFromProcess } from '../runtime/cwd.js'
import { executeToolWithPermissions } from '../runtime/toolExecutor.js'
import { nextSessionMode, sessionModeLabel, type PermissionMode, toPermissionMode, type SessionMode } from '../runtime/sessionMode.js'
import type {
  PermissionDecision,
  PermissionRequest,
  SessionPermissionRule,
} from '../tools/contracts.js'
import {
  buildBaseMessages,
  formatBytes,
  sessionMessagesToRows,
  type TurnCheckpoint,
} from './chatScreenUtils.js'
import { ChatBottomPane, type CopyPickerState, type Overlay } from './ChatBottomPane.js'
import { buildResumedSessionState, resolveModelSelection, restoreConversationState } from './chatSessionState.js'
import { runDirectToolIntent as runDirectToolIntentFlow, runStreamingTurn } from './chatTurnOrchestrator.js'

type ChatScreenProps = {
  config: EthagentConfig
  onReplaceConfig?: (next: EthagentConfig) => void
}

let rowIdSeq = 0
const nextRowId = (): string => `row-${++rowIdSeq}`
const nowIso = (): string => new Date().toISOString()
const STREAM_FLUSH_MS = 120

export const ChatScreen: React.FC<ChatScreenProps> = ({ config: initialConfig, onReplaceConfig }) => {
  useRegisterKeybindingContext('Chat')
  const { exit } = useApp()
  const [config, setConfig] = useState<EthagentConfig>(initialConfig)
  const [rows, setRows] = useState<MessageRow[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [queuedInputs, setQueuedInputs] = useState<string[]>([])
  const [turns, setTurns] = useState(0)
  const [approxTokens, setApproxTokens] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [copyPickerState, setCopyPickerState] = useState<CopyPickerState>(null)
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  const [mode, setMode] = useState<SessionMode>('chat')
  const [sessionId, setSessionId] = useState<string>(() => newSessionId())
  const [sessionKey, setSessionKey] = useState<number>(0)
  const [cwd, setCwd] = useState<string>(() => syncCwdFromProcess())
  const [statusStartedAt, setStatusStartedAt] = useState<number>(() => Date.now())

  const rowsRef = useRef<MessageRow[]>([])
  const sessionMessagesRef = useRef<SessionMessage[]>([])
  const sessionIdRef = useRef<string>(sessionId)
  const cwdRef = useRef<string>(getRuntimeCwd())
  const streamAbortRef = useRef<AbortController | null>(null)
  const pullsRef = useRef<Map<string, AbortController>>(new Map())
  const providerRef = useRef<Provider>(createProvider(initialConfig))
  const configRef = useRef<EthagentConfig>(initialConfig)
  const prevConfigRef = useRef<EthagentConfig>(initialConfig)
  const compactingRef = useRef<boolean>(false)
  const pendingAssistantTextRef = useRef<string | null>(null)
  const pendingThinkingTextRef = useRef<string | null>(null)
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drainingQueueRef = useRef<boolean>(false)
  const permissionResolveRef = useRef<((decision: PermissionDecision) => void) | null>(null)
  const permissionRulesRef = useRef<SessionPermissionRule[]>([])
  const activeCheckpointRef = useRef<TurnCheckpoint | undefined>(undefined)
  const statsSegmentStartRef = useRef<number>(0)

  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { cwdRef.current = cwd }, [cwd])

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
    void (async () => {
      try {
        permissionRulesRef.current = await loadPermissionRules(cwd)
      } catch {
        permissionRulesRef.current = []
      }
    })()
  }, [cwd])

  useEffect(() => {
    void ensureSessionMetadata(sessionId, {
      cwd,
      provider: config.provider,
      model: config.model,
      mode,
    })
  }, [config.model, config.provider, cwd, mode, sessionId])

  useEffect(() => {
    void updateSessionActivity(
      sessionId,
      { cwd, provider: config.provider, model: config.model, mode },
      { lastCwd: cwd, provider: config.provider, model: config.model, mode },
    ).catch(() => {})
  }, [config.model, config.provider, cwd, mode, sessionId])

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort()
      for (const controller of pullsRef.current.values()) controller.abort()
      pullsRef.current.clear()
      if (streamFlushTimerRef.current) clearTimeout(streamFlushTimerRef.current)
      permissionResolveRef.current?.('deny')
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

  const changeCwd = useCallback((next: string) => {
    const updated = next === getRuntimeCwd() ? next : setRuntimeCwd(next, cwdRef.current)
    cwdRef.current = updated
    setCwd(updated)
    setSessionKey(k => k + 1)
  }, [])

  const resetVisibleStats = useCallback(() => {
    statsSegmentStartRef.current = sessionMessagesRef.current.length
    setTurns(0)
    setApproxTokens(0)
    setStatusStartedAt(Date.now())
  }, [])

  const clearTranscript = useCallback(() => {
    setRows([])
    setTurns(0)
    setApproxTokens(0)
    setQueuedInputs([])
    sessionMessagesRef.current = []
    statsSegmentStartRef.current = 0
    setStatusStartedAt(Date.now())
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
        await appendSessionMessage(sessionIdRef.current, msg, {
          cwd: cwdRef.current,
          provider: configRef.current.provider,
          model: configRef.current.model,
          mode,
        })
      } catch {
      }
    },
    [mode],
  )

  const refreshVisibleStats = useCallback(
    (messages: SessionMessage[], providerSupportsTools: boolean, cwdForStats: string, configForStats: EthagentConfig) => {
      const segment = messages.slice(statsSegmentStartRef.current)
      setTurns(segment.filter(message => message.role === 'user').length)
      setApproxTokens(approximateTokens(buildBaseMessages(segment, configForStats, providerSupportsTools, cwdForStats)))
    },
    [],
  )

  const attachActiveTurn = useCallback(<T extends SessionMessage>(message: T): T => {
    const turnId = activeCheckpointRef.current?.turnId
    if (!turnId) return message
    return { ...message, turnId } as T
  }, [])

  const beginPull = useCallback((name: string): { progressId: string; signal: AbortSignal } => {
    const controller = new AbortController()
    const progressId = nextRowId()
    pullsRef.current.set(progressId, controller)
    setRows(prev => [
      ...prev,
      { role: 'progress', id: progressId, title: `pulling ${name}`, progress: 0, status: 'starting...' },
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
      const text = messageTextContent(msg)
      if (msg.role === 'user') {
        nextRows.push({ role: 'user', id: nextRowId(), content: text })
      } else if (msg.role === 'assistant') {
        nextRows.push({ role: 'assistant', id: nextRowId(), content: text })
      }
    }
    setRows(nextRows)
    setApproxTokens(approximateTokens(messages))
  }, [])

  const runCompaction = useCallback(
    async (reason: 'manual' | 'auto') => {
      if (compactingRef.current) return
      const priorMessages: Message[] = buildBaseMessages(
        sessionMessagesRef.current,
        configRef.current,
        providerRef.current.supportsTools,
        cwd,
      )
      if (priorMessages.length <= 5) {
        pushNote('not enough turns to compact yet.', 'dim')
        return
      }
      compactingRef.current = true
      pushNote(reason === 'auto' ? 'context filling up - compacting...' : 'compacting transcript...', 'dim')
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
      startedAt: statusStartedAt,
      sessionId: sessionIdRef.current,
      cwd,
      sessionMessages: () => sessionMessagesRef.current,
      mode,
      assistantTurns,
      onReplaceConfig: replaceConfig,
      onChangeCwd: changeCwd,
      onClear: clearTranscript,
      onExit: doExit,
      onResumeRequest: () => setOverlay('resume'),
      onRewindRequest: () => setOverlay('rewind'),
      onPermissionsRequest: () => setOverlay('permissions'),
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
      statusStartedAt,
      assistantTurns,
      replaceConfig,
      changeCwd,
      clearTranscript,
      doExit,
      runCompaction,
      beginPull,
      updatePull,
      finishPull,
      cwd,
      mode,
    ],
  )

  const requestPermission = useCallback(
    async (request: PermissionRequest): Promise<PermissionDecision> => {
      setPermissionRequest(request)
      setOverlay('permission')
      return await new Promise<PermissionDecision>(resolve => {
        permissionResolveRef.current = resolve
      })
    },
    [],
  )

  const resolvePermission = useCallback((decision: PermissionDecision) => {
    const resolve = permissionResolveRef.current
    permissionResolveRef.current = null
    setPermissionRequest(null)
    setOverlay('none')
    resolve?.(decision)
  }, [])

  const executeTool = useCallback(
    async (
      name: string,
      input: Record<string, unknown>,
      permissionMode: PermissionMode,
    ): Promise<{ result: { ok: boolean; summary: string; content: string }; sessionRule?: SessionPermissionRule; persistRule?: boolean }> =>
      executeToolWithPermissions({
        name,
        input,
        permissionMode,
        cwd: cwdRef.current,
        checkpoint: activeCheckpointRef.current,
        abortSignal: streamAbortRef.current?.signal,
        getPermissionRules: () => permissionRulesRef.current,
        requestPermission,
        onDirectoryChange: next => {
          cwdRef.current = next
          setCwd(next)
        },
      }),
    [requestPermission],
  )

  const applySessionRule = useCallback(
    async (sessionRule?: SessionPermissionRule, persistRule?: boolean) => {
      if (!sessionRule) return
      permissionRulesRef.current = [...permissionRulesRef.current, sessionRule]
      if (!persistRule) return
      try {
        await savePermissionRule(cwdRef.current, sessionRule)
      } catch (error: unknown) {
        pushNote(`failed to save permission rule: ${(error as Error).message}`, 'error')
      }
    },
    [pushNote],
  )

  const runStream = useCallback(
    async (userText: string) => {
      const controller = new AbortController()
      streamAbortRef.current = controller
      const result = await runStreamingTurn({
        provider: providerRef.current,
        mode,
        sessionId: sessionIdRef.current,
        userText,
        streamFlushMs: STREAM_FLUSH_MS,
        controller,
        nextRowId,
        nowIso,
        getConfig: () => configRef.current,
        getCwd: () => cwdRef.current,
        getDisplayCwd: () => compressHome(cwdRef.current),
        getSessionMessages: () => sessionMessagesRef.current,
        setActiveCheckpoint: checkpoint => { activeCheckpointRef.current = checkpoint },
        setStreaming,
        updateRows: setRows,
        pushNote,
        persistTurnMessage: message => persistSessionMessage(attachActiveTurn(message)),
        executeTool,
        applySessionRule,
        pendingAssistantTextRef,
        pendingThinkingTextRef,
        streamFlushTimerRef,
      })
      refreshVisibleStats(sessionMessagesRef.current, providerRef.current.supportsTools, cwdRef.current, configRef.current)
      streamAbortRef.current = null
      if (result.shouldCompact) {
        void runCompaction('auto')
      }
    },
    [applySessionRule, attachActiveTurn, executeTool, mode, persistSessionMessage, pushNote, refreshVisibleStats, runCompaction],
  )

  const pullInFlight = pullsRef.current.size > 0

  const runDirectToolIntent = useCallback(
    async (userText: string): Promise<boolean> => {
      const handled = await runDirectToolIntentFlow({
        mode,
        userText,
        sessionId: sessionIdRef.current,
        nextRowId,
        nowIso,
        updateRows: setRows,
        persistTurnMessage: message => persistSessionMessage(attachActiveTurn(message)),
        executeTool,
        applySessionRule,
        setActiveCheckpoint: checkpoint => { activeCheckpointRef.current = checkpoint },
      })
      if (!handled) return false
      refreshVisibleStats(sessionMessagesRef.current, providerRef.current.supportsTools, cwdRef.current, configRef.current)
      return true
    },
    [applySessionRule, attachActiveTurn, executeTool, mode, persistSessionMessage, refreshVisibleStats],
  )

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      setHistory(h => (h[h.length - 1] === value ? h : [...h, value]))
      void appendHistory(value)

      if (streaming || pullInFlight) {
        if (parseSlash(value)) {
          pushNote('slash commands cannot be queued. wait for the current task to finish.', 'dim')
          return
        }
        setQueuedInputs(prev => [...prev, value])
        return
      }

      if (parseSlash(value)) {
        const ctx = buildSlashContext()
        const result = await dispatchSlash(value, ctx)
        if (result && result.kind === 'note') {
          pushNote(result.text, result.variant ?? 'info')
        }
        return
      }

      if (await runDirectToolIntent(value)) {
        return
      }

      await runStream(value)
    },
    [buildSlashContext, pullInFlight, pushNote, runDirectToolIntent, runStream, streaming],
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
      if (overlay !== 'none') return
      const nextMode = nextSessionMode(mode)
      setMode(nextMode)
      if (nextMode === 'plan') {
        pushNote('plan mode enabled: inspection only. mutating tools and commands are blocked until you switch out.', 'dim')
        return
      }
      if (mode === 'plan' && nextMode === 'accept-edits') {
        pushNote('exited plan mode into accept-edits: reads and edits auto-allow. bash still prompts.', 'dim')
        return
      }
      if (mode === 'plan') {
        pushNote('exited plan mode into default chat.', 'dim')
        return
      }
      if (nextMode === 'accept-edits') {
        pushNote('accept-edits enabled: reads and edits auto-allow. bash still prompts.', 'dim')
        return
      }
      pushNote('returned to default chat mode.', 'dim')
    },
    { context: 'Chat', isActive: overlay === 'none' },
  )

  useKeybinding(
    'app:redraw',
    () => setSessionKey(k => k + 1),
    { context: 'Global' },
  )

  const handleModelPick = useCallback(
    async (sel: ModelPickerSelection) => {
      setOverlay('none')
      if (sel.kind === 'ollama') {
        const resolution = resolveModelSelection(sel, configRef.current, {
          defaultBaseUrlFor,
          defaultModelFor,
        })
        if (resolution.kind === 'noop') return
        try {
          await saveConfig(resolution.config)
          replaceConfig(resolution.config)
          resetVisibleStats()
          pushNote(resolution.notice, resolution.tone)
        } catch (err: unknown) {
          pushNote(`model switch failed: ${(err as Error).message}`, 'error')
        }
        return
      }
      const resolution = resolveModelSelection(sel, configRef.current, {
        defaultBaseUrlFor,
        defaultModelFor,
      })
      if (resolution.kind === 'noop') return
      const next = resolution.config
      const prefix = resolution.notice.split(' now using ')[0] ?? resolution.notice
      try {
        await saveConfig(resolution.config)
        replaceConfig(resolution.config)
        resetVisibleStats()
        pushNote(`${prefix} now using ${next.provider} · ${next.model}.`, 'dim')
      } catch (err: unknown) {
        pushNote(`provider switch failed: ${(err as Error).message}`, 'error')
      }
    },
    [pushNote, replaceConfig, resetVisibleStats],
  )

  const handleResumePick = useCallback(
    async (id: string) => {
      setOverlay('none')
      try {
        const [loaded, metadata] = await Promise.all([loadSession(id), loadSessionMetadata(id)])
        if (loaded.length === 0) {
          pushNote('session was empty.', 'error')
          return
        }
        const resumed = buildResumedSessionState({
          messages: loaded,
          metadata,
          fallbackCwd: cwd,
          currentConfig: configRef.current,
          nextRowId,
        })
        const resumedCwd = resumed.cwd
        if (resumedCwd) {
          try {
            const updated = setRuntimeCwd(resumedCwd)
            cwdRef.current = updated
            setCwd(updated)
          } catch {
            cwdRef.current = resumedCwd
            setCwd(resumedCwd)
          }
        }
        if (resumed.config) replaceConfig(resumed.config)
        setMode(resumed.mode)
        setSessionId(id)
        sessionMessagesRef.current = loaded
        statsSegmentStartRef.current = 0
        setStatusStartedAt(resumed.statusStartedAt)
        setRows(resumed.rows)
        refreshVisibleStats(loaded, providerRef.current.supportsTools, resumedCwd, configRef.current)
        setSessionKey(k => k + 1)
      } catch (err: unknown) {
        pushNote(`resume failed: ${(err as Error).message}`, 'error')
      }
    },
    [cwd, pushNote, replaceConfig],
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

  const handleRestoreConversation = useCallback((turnId: string) => {
    const restored = restoreConversationState(sessionMessagesRef.current, turnId, nextRowId)
    sessionMessagesRef.current = restored.messages
    setRows(restored.rows)
    if (restored.truncated) {
      setQueuedInputs([])
      statsSegmentStartRef.current = Math.min(statsSegmentStartRef.current, restored.messages.length)
      refreshVisibleStats(restored.messages, providerRef.current.supportsTools, cwdRef.current, configRef.current)
      setSessionKey(key => key + 1)
      return
    }
    refreshVisibleStats(restored.messages, providerRef.current.supportsTools, cwdRef.current, configRef.current)
  }, [refreshVisibleStats])

  const busy = pullInFlight
  const slashSuggestions = useMemo(getSlashSuggestions, [])

  useEffect(() => {
    if (overlay !== 'none') return
    if (streaming || pullInFlight || queuedInputs.length === 0 || drainingQueueRef.current) return
    drainingQueueRef.current = true
    const next = queuedInputs[0]
    setQueuedInputs(prev => prev.slice(1))
    void runStream(next!).finally(() => {
      drainingQueueRef.current = false
    })
  }, [overlay, pullInFlight, queuedInputs, runStream, streaming])

  const contextLine = `${config.provider} · ${config.model} · ${compressHome(cwd)}`
  const tipLine = streaming
    ? 'tip: you can keep typing and press enter to queue the next message · shift+enter for newline'
    : 'tip: type /help to get started · shift+enter for newline'

  const placeholderHints = useMemo(() => {
    if (streaming) return ['streaming... esc to cancel']
    if (pullInFlight) return ['pull in progress... ctrl+c to cancel']
    return []
  }, [streaming, pullInFlight])

  const runtimeModeLabel = sessionModeLabel(mode)
  const modeColor =
    mode === 'plan'
      ? theme.accentLavender
      : mode === 'accept-edits'
        ? theme.accentPeach
        : theme.accentMint
  const footerRight = (
    <Box flexDirection="row">
      {runtimeModeLabel ? (
        <>
          <Text color={modeColor}>{runtimeModeLabel}</Text>
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
    <ConversationStack
      header={<BrandSplash key={`splash-${sessionKey}`} contextLine={contextLine} tipLine={tipLine} />}
      rows={rows}
      transcriptActive={overlay === 'none'}
      bottomVariant={overlay === 'none' ? 'prompt' : 'overlay'}
      bottom={(
        <ChatBottomPane
          overlay={overlay}
          config={config}
          sessionId={sessionId}
          cwd={cwd}
          currentSessionId={sessionId}
          copyPickerState={copyPickerState}
          permissionRequest={permissionRequest}
          history={history}
          busy={busy}
          placeholderHints={placeholderHints}
          queuedInputs={queuedInputs}
          slashSuggestions={slashSuggestions}
          footerRight={footerRight}
          handleModelPick={handleModelPick}
          handleResumePick={handleResumePick}
          handleRestoreConversation={handleRestoreConversation}
          handleCopyDone={handleCopyDone}
          handleCopyCancel={handleCopyCancel}
          resolvePermission={resolvePermission}
          onPermissionRulesChanged={rules => { permissionRulesRef.current = rules }}
          handleSubmit={handleSubmit}
          setOverlay={setOverlay}
          pushNote={pushNote}
        />
      )}
      status={(
        <SessionStatus
          provider={config.provider}
          model={config.model}
          turns={turns}
          approxTokens={approxTokens}
          startedAt={statusStartedAt}
        />
      )}
    />
  )
}
