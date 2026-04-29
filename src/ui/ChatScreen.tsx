import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp } from 'ink'
import { compressHome } from '../utils/path.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Provider, Message } from '../providers/contracts.js'
import type { PullProgress } from '../bootstrap/ollama.js'
import { createProvider } from '../providers/registry.js'
import { approximateTokens } from '../utils/messages.js'
import {
  dispatchSlash,
  parseSlash,
  getSlashSuggestions,
  type SlashContext,
} from '../commands/index.js'
import { theme } from './theme.js'
import { BrandSplash } from './BrandSplash.js'
import { SessionStatus, formatTokens } from './SessionStatus.js'
import { formatModelDisplayName } from './modelDisplay.js'
import { toggleLatestReasoningRow, type MessageRow } from './MessageList.js'
import { ConversationStack } from './ConversationStack.js'
import { ModelPicker, type ModelPickerSelection } from './ModelPicker.js'
import type { ModelPickerContextFit } from './modelPickerOptions.js'
import type { CopyResult } from '../utils/clipboard.js'
import { useKeybinding, useRegisterKeybindingContext } from '../keybindings/KeybindingProvider.js'
import { useCancelRequest } from '../hooks/useCancelRequest.js'
import { useExitOnCtrlC } from '../hooks/useExitOnCtrlC.js'
import {
  appendSessionMessage,
  clearAllSessions,
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
  contextUsage,
  contextUsageFromTokens,
  shouldConfirmContextUsage,
  type ContextUsage,
} from '../runtime/compaction.js'
import { defaultBaseUrlFor, defaultModelFor, saveConfig } from '../storage/config.js'
import { getCwd as getRuntimeCwd, setCwd as setRuntimeCwd, syncCwdFromProcess } from '../runtime/cwd.js'
import { executeToolWithPermissions } from '../runtime/toolExecution.js'
import { nextSessionMode, sessionModeLabel, type PermissionMode, type SessionMode } from '../runtime/sessionMode.js'
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
import { ChatBottomPane, type ContextLimitState, type CopyPickerState, type IdentityOverlayState, type Overlay } from './ChatBottomPane.js'
import { setTokenIdentity, getIdentityStatus } from '../storage/identity.js'
import type { IdentityHubResult } from '../identity/IdentityHub.js'
import { buildResumedSessionState, resolveModelSelection, restoreConversationState } from './chatSessionState.js'
import { runStreamingTurn } from './chatTurnOrchestrator.js'
import { ensureLlamaCppRunnerReady } from './llamacppPreflight.js'
import type { PlanApprovalAction } from './PlanApprovalView.js'
import type { ContextLimitAction } from './ContextLimitView.js'

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
const CONTEXT_CONFIRM_PERCENT = 90

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
  const [contextLimitState, setContextLimitState] = useState<ContextLimitState>(null)
  const [modelPickerContextFit, setModelPickerContextFit] = useState<ModelPickerContextFit | null>(null)
  const [identityOverlay, setIdentityOverlay] = useState<IdentityOverlayState | null>(null)
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  const [mode, setMode] = useState<SessionMode>('chat')
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null)
  const [sessionId, setSessionId] = useState<string>(() => newSessionId())
  const [sessionKey, setSessionKey] = useState<number>(0)
  const [cwd, setCwd] = useState<string>(() => syncCwdFromProcess())
  const [statusStartedAt, setStatusStartedAt] = useState<number>(() => Date.now())
  const [activeContextUsage, setActiveContextUsage] = useState<ContextUsage>(() =>
    contextUsageFromTokens(0, initialConfig.provider, initialConfig.model),
  )

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
  const contextLimitStateRef = useRef<ContextLimitState>(null)
  const contextModelSwitchPromptRef = useRef<string | null>(null)

  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { overlayRef.current = overlay }, [overlay])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  useEffect(() => { cwdRef.current = cwd }, [cwd])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { pendingPlanRef.current = pendingPlan }, [pendingPlan])
  useEffect(() => { contextLimitStateRef.current = contextLimitState }, [contextLimitState])

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

  const updateRows = useCallback((updater: (prev: MessageRow[]) => MessageRow[]) => {
    setRows(prev => updater(prev))
  }, [])

  const pushNote = useCallback(
    (text: string, kind: 'info' | 'error' | 'dim' = 'info') => {
      updateRows(prev => [...prev, { role: 'note', id: nextRowId(), kind, content: text }])
    },
    [updateRows],
  )

  const toggleLatestReasoning = useCallback(() => {
    updateRows(toggleLatestReasoningRow)
  }, [updateRows])

  const replaceConfig = useCallback(
    (next: EthagentConfig) => {
      configRef.current = next
      providerRef.current = createProvider(next)
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

  const clearContextLimit = useCallback(() => {
    contextLimitStateRef.current = null
    setContextLimitState(null)
    if (overlayRef.current === 'contextLimit') {
      overlayRef.current = 'none'
      setOverlay('none')
    }
  }, [])

  const openModelPicker = useCallback((contextFit?: ModelPickerContextFit | null, pendingPrompt?: string | null) => {
    contextModelSwitchPromptRef.current = pendingPrompt ?? null
    setModelPickerContextFit(contextFit ?? null)
    overlayRef.current = 'modelPicker'
    setOverlay('modelPicker')
  }, [])

  const handleModelPickerCancel = useCallback(() => {
    const hadPendingPrompt = contextModelSwitchPromptRef.current !== null
    contextModelSwitchPromptRef.current = null
    setModelPickerContextFit(null)
    overlayRef.current = 'none'
    setOverlay('none')
    if (hadPendingPrompt) pushNote('pending message cancelled.', 'dim')
  }, [pushNote])

  const changeCwd = useCallback((next: string) => {
    const updated = next === getRuntimeCwd() ? next : setRuntimeCwd(next, cwdRef.current)
    cwdRef.current = updated
    setCwd(updated)
    clearPendingPlan()
    setSessionKey(k => k + 1)
  }, [clearPendingPlan])

  const clearTranscript = useCallback(() => {
    setRows([])
    setTurns(0)
    setApproxTokens(0)
    setActiveContextUsage(contextUsageFromTokens(0, configRef.current.provider, configRef.current.model))
    setQueuedInputs([])
    clearPendingPlan()
    clearContextLimit()
    contextModelSwitchPromptRef.current = null
    setModelPickerContextFit(null)
    sessionMessagesRef.current = []
    statsSegmentStartRef.current = 0
    setStatusStartedAt(Date.now())
    const nextId = newSessionId()
    sessionIdRef.current = nextId
    setSessionId(nextId)
    setSessionKey(k => k + 1)
  }, [clearContextLimit, clearPendingPlan])

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
    (messages: SessionMessage[], providerSupportsTools: boolean, cwdForStats: string, configForStats: EthagentConfig, modeForStats: SessionMode): ContextUsage => {
      const built = buildBaseMessages(messages, configForStats, providerSupportsTools, cwdForStats, modeForStats)
      const tokens = approximateTokens(built)
      const usage = contextUsageFromTokens(tokens, configForStats.provider, configForStats.model)
      setTurns(messages.filter(message => message.role === 'user').length)
      setApproxTokens(tokens)
      setActiveContextUsage(usage)
      return usage
    },
    [],
  )

  const warnIfContextPressure = useCallback(
    (usage: ContextUsage, configForUsage: EthagentConfig) => {
      if (!shouldConfirmContextUsage(usage, CONTEXT_CONFIRM_PERCENT)) return
      const action = usage.percent >= 100
        ? 'New requests will ask you to summarize into a new conversation, switch models, ignore and send, or cancel.'
        : 'Run /compact before continuing, keep the next prompt short, switch models, or choose to send despite the warning.'
      pushNote(
        `current transcript is ${usage.percent}% of ${configForUsage.model}'s context (~${formatTokens(usage.usedTokens)} / ${formatTokens(usage.windowTokens)}). ${action}`,
        usage.percent >= 100 ? 'error' : 'dim',
      )
    },
    [pushNote],
  )

  const applyConfigChange = useCallback(
    (next: EthagentConfig): ContextUsage => {
      replaceConfig(next)
      const usage = refreshVisibleStats(sessionMessagesRef.current, providerRef.current.supportsTools, cwdRef.current, next, modeRef.current)
      warnIfContextPressure(usage, next)
      return usage
    },
    [refreshVisibleStats, replaceConfig, warnIfContextPressure],
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
    updateRows(prev => [
      ...prev,
      { role: 'progress', id: progressId, title: `pulling ${name}`, progress: 0, status: 'starting...' },
    ])
    return { progressId, signal: controller.signal }
  }, [updateRows])

  const updatePull = useCallback((progressId: string, event: PullProgress) => {
    updateRows(prev =>
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
  }, [updateRows])

  const finishPull = useCallback((progressId: string, model: string, error?: string) => {
    pullsRef.current.delete(progressId)
    updateRows(prev => {
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
  }, [updateRows])

  const runCompaction = useCallback(
    async (): Promise<boolean> => {
      if (compactingRef.current) return false
      const sourceSessionId = sessionIdRef.current
      const sourceMessages = sessionMessagesRef.current
      const priorMessages: Message[] = buildBaseMessages(
        sourceMessages,
        configRef.current,
        providerRef.current.supportsTools,
        cwdRef.current,
        modeRef.current,
      )
      if (priorMessages.length <= 5) {
        pushNote('not enough turns to compact yet.', 'dim')
        return false
      }
      compactingRef.current = true
      pushNote('summarizing into a new conversation; current conversation remains active.', 'dim')
      try {
        const result = await compactTranscript(providerRef.current, priorMessages)
        if (!result.ok) {
          pushNote(`compact failed: ${result.reason}`, 'error')
          return false
        }

        const nextSessionId = newSessionId()
        const createdAt = nowIso()
        const summaryMessage: SessionMessage = {
          role: 'user',
          content: [
            `Summary of conversation ${sourceSessionId.slice(0, 8)}:`,
            '',
            result.summary,
          ].join('\n'),
          createdAt,
        }
        const acknowledgement: SessionMessage = {
          role: 'assistant',
          content: 'Ready to continue from this summary.',
          createdAt: nowIso(),
          model: configRef.current.model,
        }

        const context = {
          cwd: cwdRef.current,
          provider: configRef.current.provider,
          model: configRef.current.model,
          mode: modeRef.current,
        }
        await ensureSessionMetadata(nextSessionId, context)
        await updateSessionActivity(
          nextSessionId,
          context,
          { compactedFromSessionId: sourceSessionId },
        )
        await appendSessionMessage(nextSessionId, summaryMessage, context)
        await appendSessionMessage(nextSessionId, acknowledgement, context)

        const nextMessages = [summaryMessage, acknowledgement]
        sessionIdRef.current = nextSessionId
        setSessionId(nextSessionId)
        sessionMessagesRef.current = nextMessages
        statsSegmentStartRef.current = 0
        setRows([
          {
            role: 'note',
            id: nextRowId(),
            kind: 'dim',
            content: `kept ${sourceSessionId.slice(0, 8)} active; summarized into ${nextSessionId.slice(0, 8)}.`,
          },
          ...sessionMessagesToRows(nextMessages, nextRowId),
        ])
        setQueuedInputs([])
        setStatusStartedAt(Date.now())
        refreshVisibleStats(nextMessages, providerRef.current.supportsTools, cwdRef.current, configRef.current, modeRef.current)
        setSessionKey(key => key + 1)
        return true
      } catch (err: unknown) {
        pushNote(`compact error: ${(err as Error).message}`, 'error')
        return false
      } finally {
        compactingRef.current = false
      }
    },
    [pushNote, refreshVisibleStats],
  )

  const assistantTurns = useCallback((): string[] => {
    const out: string[] = []
    for (const message of sessionMessagesRef.current) {
      if (message.role === 'assistant' && message.content) out.push(message.content)
    }
    return out
  }, [])

  const buildSlashContext = useCallback(
    (): SlashContext => ({
      config: configRef.current,
      turns,
      approxTokens,
      contextUsage: activeContextUsage,
      startedAt: statusStartedAt,
      sessionId: sessionIdRef.current,
      cwd,
      sessionMessages: () => sessionMessagesRef.current,
      mode,
      assistantTurns,
      onReplaceConfig: applyConfigChange,
      onChangeCwd: changeCwd,
      onClear: clearTranscript,
      onExit: doExit,
      onResumeRequest: () => setOverlay('resume'),
      onModelPickerRequest: () => openModelPicker(),
      onRewindRequest: () => setOverlay('rewind'),
      onPermissionsRequest: () => setOverlay('permissions'),
      onCompactRequest: () => { void runCompaction() },
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
      applyConfigChange,
      changeCwd,
      clearTranscript,
      doExit,
      openModelPicker,
      runCompaction,
      beginPull,
      updatePull,
      finishPull,
      cwd,
      mode,
      activeContextUsage,
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
        updateRows,
        pushNote,
        persistTurnMessage: message => persistSessionMessage(attachActiveTurn(message)),
        executeTool,
        applySessionRule,
        preflightProvider: () => ensureLlamaCppRunnerReady(configRef.current),
        onPlanReady: plan => {
          planCandidate = {
            text: plan,
            cwd: cwdRef.current,
            sessionId: sessionIdRef.current,
            provider: configRef.current.provider,
            model: configRef.current.model,
            contextLabel: formatContextLabel(
              contextUsage(buildBaseMessages(sessionMessagesRef.current, configRef.current, turnProvider.supportsTools, cwdRef.current, activeMode), configRef.current.provider, configRef.current.model),
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
    [applySessionRule, attachActiveTurn, executeTool, mode, persistSessionMessage, pushNote, refreshVisibleStats, updateRows],
  )

  const pullInFlight = pullsRef.current.size > 0

  const projectedUsageForInput = useCallback((userText: string, modeOverride?: SessionMode): ContextUsage => {
    const activeMode = modeOverride ?? modeRef.current
    const turnProvider = createProvider(configRef.current, { mode: activeMode })
    const projectedMessages: SessionMessage[] = [
      ...sessionMessagesRef.current,
      { role: 'user', content: userText, createdAt: nowIso() },
    ]
    return contextUsage(
      buildBaseMessages(projectedMessages, configRef.current, turnProvider.supportsTools, cwdRef.current, activeMode),
      configRef.current.provider,
      configRef.current.model,
    )
  }, [])

  const showContextLimitForPrompt = useCallback((prompt: string): ContextUsage => {
    contextModelSwitchPromptRef.current = null
    setModelPickerContextFit(null)
    const projected = projectedUsageForInput(prompt)
    contextLimitStateRef.current = { usage: projected, prompt }
    setContextLimitState(contextLimitStateRef.current)
    overlayRef.current = 'contextLimit'
    setOverlay('contextLimit')
    return projected
  }, [projectedUsageForInput])

  const continuePendingPromptAfterModelSwitch = useCallback(
    async (prompt: string | null) => {
      if (!prompt) {
        setModelPickerContextFit(null)
        return
      }
      contextModelSwitchPromptRef.current = null
      setModelPickerContextFit(null)
      const projected = projectedUsageForInput(prompt)
      if (shouldConfirmContextUsage(projected, CONTEXT_CONFIRM_PERCENT)) {
        contextLimitStateRef.current = { usage: projected, prompt }
        setContextLimitState(contextLimitStateRef.current)
        overlayRef.current = 'contextLimit'
        setOverlay('contextLimit')
        pushNote(
          `selected model is still ${projected.percent}% of its context (~${formatTokens(projected.usedTokens)} / ${formatTokens(projected.windowTokens)}).`,
          projected.percent >= 100 ? 'error' : 'dim',
        )
        return
      }
      await runStream(prompt)
    },
    [projectedUsageForInput, pushNote, runStream],
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

      const projected = projectedUsageForInput(value)
      if (shouldConfirmContextUsage(projected, CONTEXT_CONFIRM_PERCENT)) {
        showContextLimitForPrompt(value)
        return
      }

      await runStream(value)
    },
    [buildSlashContext, pullInFlight, projectedUsageForInput, pushNote, runStream, showContextLimitForPrompt, streaming],
  )

  const handleContextLimitCancel = useCallback(() => {
    clearContextLimit()
    pushNote('pending message cancelled.', 'dim')
  }, [clearContextLimit, pushNote])

  const handleContextLimitAction = useCallback(
    async (action: ContextLimitAction) => {
      const state = contextLimitStateRef.current
      if (!state) {
        clearContextLimit()
        return
      }
      const prompt = state.prompt
      clearContextLimit()
      if (action === 'cancel') {
        pushNote('pending message cancelled.', 'dim')
        return
      }
      if (action === 'switchModel') {
        openModelPicker(
          { usedTokens: state.usage.usedTokens, thresholdPercent: CONTEXT_CONFIRM_PERCENT },
          prompt,
        )
        return
      }
      if (action === 'compact') {
        const compacted = await runCompaction()
        if (!compacted) return
      }
      if (action === 'send') {
        pushNote(
          'sending despite context warning; this may hit provider rate/context limits faster or degrade model/tool behavior.',
          'dim',
        )
      }
      await runStream(prompt)
    },
    [clearContextLimit, openModelPicker, pushNote, runCompaction, runStream],
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
    () => { if (overlay === 'none') openModelPicker() },
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
    'chat:toggleReasoning',
    () => { if (overlay === 'none') toggleLatestReasoning() },
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
      const pendingPrompt = contextModelSwitchPromptRef.current
      overlayRef.current = 'none'
      setOverlay('none')
      if (sel.kind === 'ollama') {
        const resolution = resolveModelSelection(sel, configRef.current, {
          defaultBaseUrlFor,
          defaultModelFor,
        })
        if (resolution.kind === 'noop') {
          if (pendingPrompt) showContextLimitForPrompt(pendingPrompt)
          return
        }
        try {
          await saveConfig(resolution.config)
          applyConfigChange(resolution.config)
          pushNote(resolution.notice, resolution.tone)
          await continuePendingPromptAfterModelSwitch(pendingPrompt)
        } catch (err: unknown) {
          pushNote(`model switch failed: ${(err as Error).message}`, 'error')
          if (pendingPrompt) showContextLimitForPrompt(pendingPrompt)
        }
        return
      }
      const resolution = resolveModelSelection(sel, configRef.current, {
        defaultBaseUrlFor,
        defaultModelFor,
      })
      if (resolution.kind === 'noop') {
        if (pendingPrompt) showContextLimitForPrompt(pendingPrompt)
        return
      }
      try {
        await saveConfig(resolution.config)
        applyConfigChange(resolution.config)
        pushNote(resolution.notice, resolution.tone)
        await continuePendingPromptAfterModelSwitch(pendingPrompt)
      } catch (err: unknown) {
        pushNote(`provider switch failed: ${(err as Error).message}`, 'error')
        if (pendingPrompt) showContextLimitForPrompt(pendingPrompt)
      }
    },
    [applyConfigChange, continuePendingPromptAfterModelSwitch, pushNote, showContextLimitForPrompt],
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
        clearContextLimit()
        modeRef.current = resumed.mode
        setMode(resumed.mode)
        sessionIdRef.current = id
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
    [clearContextLimit, clearPendingPlan, cwd, pushNote, refreshVisibleStats, replaceConfig],
  )

  const handleResumeClearAll = useCallback(
    async () => {
      await clearAllSessions()
      clearTranscript()
      overlayRef.current = 'none'
      setOverlay('none')
      pushNote('cleared saved chat logs and resume context from this machine.', 'dim')
    },
    [clearTranscript, pushNote],
  )

  const handleIdentityResult = useCallback(
    (result: IdentityHubResult) => {
      setOverlay('none')
      setIdentityOverlay(null)
      if (result.kind === 'updated') {
        applyConfigChange(result.config)
        pushNote(result.message, 'info')
        return
      }
      if (result.kind === 'token') {
        void (async () => {
          try {
            const nextConfig = await setTokenIdentity(configRef.current, result.identity)
            applyConfigChange(nextConfig)
            pushNote(`identity saved · ERC-8004 #${result.identity.agentId}`, 'info')
          } catch (err: unknown) {
            pushNote(`identity save failed: ${(err as Error).message}`, 'error')
          }
        })()
      }
    },
    [applyConfigChange, pushNote],
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

  const startSummarizedPlanImplementationContext = useCallback(
    async (plan: string): Promise<boolean> => {
      if (compactingRef.current) return false

      const sourceSessionId = sessionIdRef.current
      const priorMessages = buildBaseMessages(
        sessionMessagesRef.current,
        configRef.current,
        providerRef.current.supportsTools,
        cwdRef.current,
        modeRef.current,
      )

      if (priorMessages.length <= 5) {
        startFreshImplementationContext()
        pushNote('not enough planning context to summarize; starting a plan-only implementation conversation.', 'dim')
        return true
      }

      compactingRef.current = true
      pushNote('summarizing planning context into a new conversation; this conversation remains active.', 'dim')
      try {
        const result = await compactTranscript(providerRef.current, priorMessages)
        if (!result.ok) {
          pushNote(`context summary failed: ${result.reason}`, 'error')
          return false
        }

        const nextSessionId = newSessionId()
        const createdAt = nowIso()
        const nextMessages = buildPlanTransferSeedMessages({
          sourceSessionId,
          summary: result.summary,
          plan,
          createdAt,
        })
        const context = {
          cwd: cwdRef.current,
          provider: configRef.current.provider,
          model: configRef.current.model,
          mode: modeRef.current,
        }

        await ensureSessionMetadata(nextSessionId, context)
        await updateSessionActivity(nextSessionId, context, { compactedFromSessionId: sourceSessionId })
        for (const message of nextMessages) {
          await appendSessionMessage(nextSessionId, message, context)
        }

        sessionIdRef.current = nextSessionId
        setSessionId(nextSessionId)
        sessionMessagesRef.current = nextMessages
        statsSegmentStartRef.current = 0
        setRows([
          {
            role: 'note',
            id: nextRowId(),
            kind: 'dim',
            content: `kept ${sourceSessionId.slice(0, 8)} active; transferred plan into ${nextSessionId.slice(0, 8)}.`,
          },
          ...sessionMessagesToRows(nextMessages, nextRowId),
        ])
        setQueuedInputs([])
        setStatusStartedAt(Date.now())
        refreshVisibleStats(nextMessages, providerRef.current.supportsTools, cwdRef.current, configRef.current, modeRef.current)
        setSessionKey(key => key + 1)
        return true
      } catch (err: unknown) {
        pushNote(`context summary error: ${(err as Error).message}`, 'error')
        return false
      } finally {
        compactingRef.current = false
      }
    },
    [pushNote, refreshVisibleStats, startFreshImplementationContext],
  )

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
      if (action === 'apply-summary') {
        const transferred = await startSummarizedPlanImplementationContext(plan.text)
        if (!transferred) return
      }
      clearPendingPlan()
      modeRef.current = nextMode
      setMode(nextMode)
      await runStream(buildPlanImplementationPrompt(plan.text), nextMode)
    },
    [
      clearPendingPlan,
      handlePlanApprovalCancel,
      pushNote,
      runStream,
      startSummarizedPlanImplementationContext,
    ],
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
    void (async () => {
      if (!next) return
      const projected = projectedUsageForInput(next)
      if (shouldConfirmContextUsage(projected, CONTEXT_CONFIRM_PERCENT)) {
        showContextLimitForPrompt(next)
        return
      }
      await runStream(next)
    })().finally(() => {
      drainingQueueRef.current = false
    })
  }, [overlay, projectedUsageForInput, pullInFlight, pushNote, queuedInputs, runStream, showContextLimitForPrompt, streaming])

  const contextLine = `${config.provider} · ${formatModelDisplayName(config.provider, config.model, { maxLength: 24 })} · ${compressHome(cwd)}`
  const tipLine = streaming
    ? 'tip: you can keep typing and press enter to queue the next message · shift+enter for newline'
    : 'tip: type /help to get started · shift+enter for newline'

  const placeholderHints = useMemo(() => {
    if (pullInFlight) return ['pull in progress… ctrl+c to cancel']
    return []
  }, [pullInFlight])

  const exitHint = exitState.pending ? 'ctrl+c again to quit' : null
  const runtimeModeLabel = sessionModeLabel(mode)
  const modeColor =
    mode === 'plan'
      ? theme.accentLavender
      : mode === 'accept-edits'
        ? theme.accentPeach
        : theme.accentMint
  const footerRight = (
    <Box flexDirection="row">
      {exitHint ? (
        <>
          <Text color={theme.accentPrimary}>{exitHint}</Text>
          <Text color={theme.dim}> · </Text>
        </>
      ) : null}
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
      <Text color={theme.dim}>
        {'esc cancels · pgup/pgdn scroll · alt+p model · alt+i identity'}
      </Text>
    </Box>
  )
  const header = <BrandSplash contextLine={contextLine} tipLine={tipLine} />
  return (
    <ConversationStack
      header={header}
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
          contextLimitState={contextLimitState}
          modelPickerContextFit={modelPickerContextFit}
          permissionRequest={permissionRequest}
          history={history}
          busy={busy}
          streaming={streaming}
          placeholderHints={placeholderHints}
          queuedInputs={queuedInputs}
          slashSuggestions={slashSuggestions}
          planApprovalContextLabel={pendingPlan?.contextLabel ?? formatContextLabel(activeContextUsage)}
          footerRight={footerRight}
          handleModelPick={handleModelPick}
          handleModelPickerCancel={handleModelPickerCancel}
          handleResumePick={handleResumePick}
          handleResumeClearAll={handleResumeClearAll}
          identityOverlay={identityOverlay}
          handleIdentityResult={handleIdentityResult}
          handleRestoreConversation={handleRestoreConversation}
          handleCopyDone={handleCopyDone}
          handleCopyCancel={handleCopyCancel}
          resolvePermission={resolvePermission}
          handlePlanApproval={handlePlanApproval}
          handlePlanApprovalCancel={handlePlanApprovalCancel}
          handleContextLimitAction={handleContextLimitAction}
          handleContextLimitCancel={handleContextLimitCancel}
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
          contextUsage={activeContextUsage}
        />
      )}
      sessionKey={sessionKey}
    />
  )
}

function formatContextLabel(usage: ContextUsage): string {
  if (!Number.isFinite(usage.usedTokens) || usage.usedTokens <= 0) return 'Estimated context: empty'
  return `Estimated context: ${usage.percent}% used`
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

export function buildPlanTransferSeedMessages(args: {
  sourceSessionId: string
  summary: string
  plan: string
  createdAt: string
}): SessionMessage[] {
  return [
    {
      role: 'user',
      content: [
        `Planning context summary from conversation ${args.sourceSessionId.slice(0, 8)}:`,
        '',
        args.summary.trim(),
      ].join('\n'),
      createdAt: args.createdAt,
    },
    {
      role: 'user',
      content: [
        'Approved plan to implement:',
        '',
        args.plan.trim(),
      ].join('\n'),
      createdAt: args.createdAt,
    },
  ]
}
