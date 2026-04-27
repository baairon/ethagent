import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import { compressHome } from '../utils/path.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Provider, Message } from '../providers/contracts.js'
import type { PullProgress } from '../bootstrap/ollama.js'
import { createProvider } from '../providers/registry.js'
import { approximateTokens, messageTextContent } from '../utils/messages.js'
import {
  dispatchSlash,
  parseSlash,
  getSlashSuggestions,
  type SlashContext,
} from '../commands/index.js'
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
} from '../runtime/compaction.js'
import { defaultBaseUrlFor, defaultModelFor, saveConfig } from '../storage/config.js'
import { getCwd as getRuntimeCwd, setCwd as setRuntimeCwd, syncCwdFromProcess } from '../runtime/cwd.js'
import { executeToolWithPermissions } from '../runtime/toolExecution.js'
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
import { ChatBottomPane, type CopyPickerState, type IdentityOverlayState, type Overlay } from './ChatBottomPane.js'
import { setTokenIdentity, getIdentityStatus } from '../storage/identity.js'
import type { IdentityHubResult } from '../identity/IdentityHub.js'
import { buildResumedSessionState, resolveModelSelection, restoreConversationState } from './chatSessionState.js'
import { runStreamingTurn } from './chatTurnOrchestrator.js'
import type { PlanApprovalAction } from './PlanApprovalView.js'

type ChatScreenProps = {
  config: EthagentConfig
  onReplaceConfig?: (next: EthagentConfig) => void
}

type PendingPlan = {
  text: string
  cwd: string
  sessionId: string
  provider: string
  model: string
  contextLabel: string
  awaitingApproval: boolean
}

let rowIdSeq = 0
const nextRowId = (): string => `row-${++rowIdSeq}`
const nowIso = (): string => new Date().toISOString()
const STREAM_FLUSH_MS = 120
const SOFT_CONTEXT_LIMIT_TOKENS = 32_000

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
  const [identityOverlay, setIdentityOverlay] = useState<IdentityOverlayState | null>(null)
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  const [mode, setMode] = useState<SessionMode>('chat')
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null)
  const [sessionId, setSessionId] = useState<string>(() => newSessionId())
  const [sessionKey, setSessionKey] = useState<number>(0)
  const [cwd, setCwd] = useState<string>(() => syncCwdFromProcess())
  const [statusStartedAt, setStatusStartedAt] = useState<number>(() => Date.now())

  const rowsRef = useRef<MessageRow[]>([])
  const sessionMessagesRef = useRef<SessionMessage[]>([])
  const sessionIdRef = useRef<string>(sessionId)
  const cwdRef = useRef<string>(getRuntimeCwd())
  const overlayRef = useRef<Overlay>(overlay)
  const modeRef = useRef<SessionMode>(mode)
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
  const pendingPlanRef = useRef<PendingPlan | null>(null)

  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { overlayRef.current = overlay }, [overlay])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { cwdRef.current = cwd }, [cwd])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { pendingPlanRef.current = pendingPlan }, [pendingPlan])

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

  const clearPendingPlan = useCallback(() => {
    pendingPlanRef.current = null
    setPendingPlan(null)
    if (overlayRef.current === 'planApproval') {
      overlayRef.current = 'none'
      setOverlay('none')
    }
  }, [])

  const changeCwd = useCallback((next: string) => {
    const updated = next === getRuntimeCwd() ? next : setRuntimeCwd(next, cwdRef.current)
    cwdRef.current = updated
    setCwd(updated)
    clearPendingPlan()
    setSessionKey(k => k + 1)
  }, [clearPendingPlan])

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
    clearPendingPlan()
    sessionMessagesRef.current = []
    statsSegmentStartRef.current = 0
    setStatusStartedAt(Date.now())
    setSessionId(newSessionId())
    setSessionKey(k => k + 1)
  }, [clearPendingPlan])

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
          mode: modeRef.current,
        })
      } catch {
      }
    },
    [],
  )

  const refreshVisibleStats = useCallback(
    (messages: SessionMessage[], providerSupportsTools: boolean, cwdForStats: string, configForStats: EthagentConfig, modeForStats: SessionMode) => {
      const segment = messages.slice(statsSegmentStartRef.current)
      setTurns(segment.filter(message => message.role === 'user').length)
      setApproxTokens(approximateTokens(buildBaseMessages(segment, configForStats, providerSupportsTools, cwdForStats, modeForStats)))
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
        mode,
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
    [mode, pushNote, reinstateFromMessages],
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
      onModelPickerRequest: () => setOverlay('modelPicker'),
      onRewindRequest: () => setOverlay('rewind'),
      onPermissionsRequest: () => setOverlay('permissions'),
      onCompactRequest: () => { void runCompaction('manual') },
      onIdentityRequest: action => {
        void (async () => {
          const status = await getIdentityStatus(configRef.current)
          const initialAction = action === 'create' || action === 'load' ? action : undefined
          setIdentityOverlay({
            initialAction,
            existing: status ? { address: status.address } : null,
          })
          setOverlay('identity')
        })()
      },
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
    async (userText: string, modeOverride?: SessionMode) => {
      const activeMode = modeOverride ?? mode
      const turnProvider = createProvider(configRef.current, { mode: activeMode })
      const controller = new AbortController()
      streamAbortRef.current = controller
      let planCandidate: PendingPlan | null = null
      const result = await runStreamingTurn({
        provider: turnProvider,
        mode: activeMode,
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
        onPlanReady: plan => {
          planCandidate = {
            text: plan,
            cwd: cwdRef.current,
            sessionId: sessionIdRef.current,
            provider: configRef.current.provider,
            model: configRef.current.model,
            contextLabel: estimatedContextLabel(
              approximateTokens(buildBaseMessages(sessionMessagesRef.current, configRef.current, turnProvider.supportsTools, cwdRef.current, activeMode)),
            ),
            awaitingApproval: true,
          }
          pendingPlanRef.current = planCandidate
          setPendingPlan(planCandidate)
        },
        pendingAssistantTextRef,
        pendingThinkingTextRef,
        streamFlushTimerRef,
      })
      refreshVisibleStats(sessionMessagesRef.current, turnProvider.supportsTools, cwdRef.current, configRef.current, activeMode)
      streamAbortRef.current = null
      if (result.shouldCompact) {
        void runCompaction('auto')
      }
      if (
        result.finishedNormally &&
        activeMode === 'plan' &&
        planCandidate &&
        pendingPlanRef.current === planCandidate &&
        overlayRef.current === 'none'
      ) {
        overlayRef.current = 'planApproval'
        setOverlay('planApproval')
      }
    },
    [applySessionRule, attachActiveTurn, executeTool, mode, persistSessionMessage, pushNote, refreshVisibleStats, runCompaction],
  )

  const pullInFlight = pullsRef.current.size > 0

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

      await runStream(value)
    },
    [buildSlashContext, pullInFlight, pushNote, runStream, streaming],
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
    'chat:identityHub',
    () => {
      if (overlay !== 'none') return
      setIdentityOverlay({
        initialAction: undefined,
        existing: configRef.current.identity ? { address: configRef.current.identity.address } : null,
      })
      setOverlay('identity')
    },
    { context: 'Chat', isActive: overlay === 'none' },
  )

  useKeybinding(
    'chat:cycleMode',
    () => {
      if (overlay !== 'none') return
      const nextMode = nextSessionMode(mode)
      modeRef.current = nextMode
      setMode(nextMode)
      if (nextMode !== 'plan') clearPendingPlan()
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
      try {
        await saveConfig(resolution.config)
        replaceConfig(resolution.config)
        resetVisibleStats()
        pushNote(resolution.notice, resolution.tone)
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
        clearPendingPlan()
        modeRef.current = resumed.mode
        setMode(resumed.mode)
        setSessionId(id)
        sessionMessagesRef.current = loaded
        statsSegmentStartRef.current = 0
        setStatusStartedAt(resumed.statusStartedAt)
        setRows(resumed.rows)
        refreshVisibleStats(loaded, providerRef.current.supportsTools, resumedCwd, configRef.current, resumed.mode)
        setSessionKey(k => k + 1)
      } catch (err: unknown) {
        pushNote(`resume failed: ${(err as Error).message}`, 'error')
      }
    },
    [cwd, pushNote, replaceConfig],
  )

  const handleIdentityResult = useCallback(
    (result: IdentityHubResult) => {
      setOverlay('none')
      setIdentityOverlay(null)
      if (result.kind === 'updated') {
        replaceConfig(result.config)
        pushNote(result.message, 'info')
        return
      }
      if (result.kind === 'token') {
        void (async () => {
          try {
            const nextConfig = await setTokenIdentity(configRef.current, result.identity)
            replaceConfig(nextConfig)
            pushNote(`identity saved · ERC-8004 #${result.identity.agentId}`, 'info')
          } catch (err: unknown) {
            pushNote(`identity save failed: ${(err as Error).message}`, 'error')
          }
        })()
      }
    },
    [pushNote, replaceConfig],
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
      refreshVisibleStats(restored.messages, providerRef.current.supportsTools, cwdRef.current, configRef.current, mode)
      setSessionKey(key => key + 1)
      return
    }
    refreshVisibleStats(restored.messages, providerRef.current.supportsTools, cwdRef.current, configRef.current, mode)
  }, [mode, refreshVisibleStats])

  const startFreshImplementationContext = useCallback(() => {
    const nextSessionId = newSessionId()
    sessionMessagesRef.current = []
    statsSegmentStartRef.current = 0
    sessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
    setRows([])
    setTurns(0)
    setApproxTokens(0)
    setQueuedInputs([])
    setStatusStartedAt(Date.now())
    setSessionKey(key => key + 1)
  }, [])

  const handlePlanApprovalCancel = useCallback(() => {
    const plan = pendingPlanRef.current
    if (plan) {
      const next = { ...plan, awaitingApproval: false }
      pendingPlanRef.current = next
      setPendingPlan(next)
    }
    if (overlayRef.current === 'planApproval') {
      overlayRef.current = 'none'
      setOverlay('none')
    }
  }, [])

  const handlePlanApproval = useCallback(
    async (action: PlanApprovalAction) => {
      const plan = pendingPlanRef.current
      if (!plan) {
        handlePlanApprovalCancel()
        return
      }
      if (plan.cwd !== cwdRef.current || plan.sessionId !== sessionIdRef.current) {
        clearPendingPlan()
        pushNote('dismissed stale plan approval because the workspace changed.', 'dim')
        return
      }
      if (action === 'continue') {
        handlePlanApprovalCancel()
        return
      }

      const nextMode: SessionMode = 'accept-edits'
      clearPendingPlan()
      modeRef.current = nextMode
      setMode(nextMode)
      if (action === 'apply-fresh') {
        startFreshImplementationContext()
      }
      await runStream(buildPlanImplementationPrompt(plan.text), nextMode)
    },
    [clearPendingPlan, handlePlanApprovalCancel, pushNote, runStream, startFreshImplementationContext],
  )

  const busy = pullInFlight
  const slashSuggestions = useMemo(getSlashSuggestions, [])

  useEffect(() => {
    const plan = pendingPlanRef.current
    if (!plan?.awaitingApproval) return
    if (mode !== 'plan' || overlay !== 'none' || streaming || pullInFlight) return
    if (plan.cwd !== cwdRef.current || plan.sessionId !== sessionIdRef.current) {
      clearPendingPlan()
      return
    }
    overlayRef.current = 'planApproval'
    setOverlay('planApproval')
  }, [clearPendingPlan, mode, overlay, pullInFlight, streaming])

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
      <Text color={theme.dim}>esc cancels · alt+p model · alt+i identity</Text>
    </Box>
  )
  const exitHint = exitState.pending ? 'press ctrl + c again to exit' : null

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
          planApprovalContextLabel={pendingPlan?.contextLabel ?? estimatedContextLabel(approxTokens)}
          footerRight={footerRight}
          exitHint={exitHint}
          handleModelPick={handleModelPick}
          handleResumePick={handleResumePick}
          identityOverlay={identityOverlay}
          handleIdentityResult={handleIdentityResult}
          handleRestoreConversation={handleRestoreConversation}
          handleCopyDone={handleCopyDone}
          handleCopyCancel={handleCopyCancel}
          resolvePermission={resolvePermission}
          handlePlanApproval={handlePlanApproval}
          handlePlanApprovalCancel={handlePlanApprovalCancel}
          onPermissionRulesChanged={rules => { permissionRulesRef.current = rules }}
          onConfigChange={replaceConfig}
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

function estimatedContextLabel(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return 'Estimated context: empty'
  const percent = Math.max(0, Math.min(99, Math.round((tokens / SOFT_CONTEXT_LIMIT_TOKENS) * 100)))
  return `Estimated context: ~${percent}% used`
}

export function buildPlanImplementationPrompt(plan: string): string {
  return [
    'Implement the approved plan below.',
    '',
    'Use native ethagent tools directly. Do not translate tool names into shell commands.',
    'For workspace inspection, call list_directory and read_file directly.',
    'For file creation or edits, call edit_file directly.',
    'Use run_bash only for an actual shell command that cannot be performed by a narrower native tool, such as starting a local server after files exist.',
    'Ignore any plan wording that says to execute file work as a Bash script or directly in the terminal; the native tools above are authoritative.',
    'Read the relevant files before editing, make the required changes, and verify the result when possible.',
    '',
    plan,
  ].join('\n')
}
