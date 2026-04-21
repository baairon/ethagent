import type { Message, Provider } from '../providers/contracts.js'
import { runTurn } from '../core/chatLoop.js'
import { detectDeleteFileIntent, detectDirectoryChangeIntent } from '../core/fallbackToolUse.js'
import {
  buildPreToolPlanningPrompt,
  buildToolInputRepairPrompt,
  buildToolRetryPrompt,
  normalizeToolWorkFromAssistant,
  shouldForceToolRetry,
  shouldRetryRejectedToolInput,
} from '../runtime/turnPolicy.js'
import { shouldAutoCompact } from '../core/compaction.js'
import { toPermissionMode, type SessionMode } from '../runtime/sessionMode.js'
import type { EthagentConfig } from '../storage/config.js'
import type { SessionMessage } from '../storage/sessions.js'
import type { SessionPermissionRule, ToolResult } from '../tools/contracts.js'
import type { MessageRow } from './MessageList.js'
import {
  buildBaseMessages,
  buildDeleteCommand,
  createTurnCheckpoint,
  shouldPrimeToolPlanning,
  splitStreamingContent,
  summarizeToolInput,
  truncateForRow,
  type TurnCheckpoint,
} from './chatScreenUtils.js'

type MutableRef<T> = { current: T }

type ExecuteToolResult = {
  result: ToolResult
  sessionRule?: SessionPermissionRule
  persistRule?: boolean
}

export type TurnOrchestratorContext = {
  provider: Provider
  mode: SessionMode
  sessionId: string
  userText: string
  streamFlushMs: number
  controller: AbortController
  nextRowId: () => string
  nowIso: () => string
  getConfig: () => EthagentConfig
  getCwd: () => string
  getDisplayCwd: () => string
  getSessionMessages: () => SessionMessage[]
  setActiveCheckpoint: (checkpoint: TurnCheckpoint | undefined) => void
  setStreaming: (streaming: boolean) => void
  updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => void
  pushNote: (text: string, kind?: 'info' | 'error' | 'dim') => void
  persistTurnMessage: (message: SessionMessage) => Promise<void>
  executeTool: (
    name: string,
    input: Record<string, unknown>,
    mode: ReturnType<typeof toPermissionMode>,
  ) => Promise<ExecuteToolResult>
  applySessionRule: (rule?: SessionPermissionRule, persistRule?: boolean) => Promise<void>
  pendingAssistantTextRef: MutableRef<string | null>
  pendingThinkingTextRef: MutableRef<string | null>
  streamFlushTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>
}

export type StreamingTurnResult = {
  finishedNormally: boolean
  cancelled: boolean
  shouldCompact: boolean
}

export async function runStreamingTurn(context: TurnOrchestratorContext): Promise<StreamingTurnResult> {
  const {
    provider,
    mode,
    sessionId,
    userText,
    streamFlushMs,
    controller,
    nextRowId,
    nowIso,
    getConfig,
    getCwd,
    getDisplayCwd,
    getSessionMessages,
    setActiveCheckpoint,
    setStreaming,
    updateRows,
    pushNote,
    persistTurnMessage,
    executeTool,
    applySessionRule,
    pendingAssistantTextRef,
    pendingThinkingTextRef,
    streamFlushTimerRef,
  } = context

  if (mode === 'plan') {
    pushNote('plan mode: answering without touching the filesystem.', 'dim')
  } else if (mode === 'accept-edits') {
    pushNote(
      provider.supportsTools
        ? 'accept-edits mode: read and edit tools will auto-allow. bash still prompts.'
        : 'accept-edits mode selected, but the current provider does not support tools yet.',
      'dim',
    )
  }

  setStreaming(true)
  setActiveCheckpoint(createTurnCheckpoint(sessionId, userText))

  updateRows(prev => [...prev, { role: 'user', id: nextRowId(), content: userText }])
  await persistTurnMessage({ role: 'user', content: userText, createdAt: nowIso() })

  let workingMessages = buildWorkingMessages(context)
  if (provider.supportsTools && shouldPrimeToolPlanning(userText)) {
    workingMessages = [
      ...workingMessages,
      { role: 'user', content: buildPreToolPlanningPrompt(getDisplayCwd()) },
    ]
  }

  let finishedNormally = false
  let cancelled = false
  let toolRetryCount = 0

  while (!controller.signal.aborted) {
    let accumulated = ''
    let thinkingContent = ''
    let thinkingRowId: string | null = null
    let assistantId: string | null = null
    const pendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    let errored = false

    const ensureAssistantRow = () => {
      if (assistantId) return assistantId
      assistantId = nextRowId()
      updateRows(prev => [...prev, { role: 'assistant', id: assistantId!, content: '', liveTail: '', streaming: true }])
      return assistantId
    }

    const flushStreamRows = (immediate = false) => {
      const commit = () => {
        streamFlushTimerRef.current = null
        const nextAssistant = pendingAssistantTextRef.current
        const nextThinking = pendingThinkingTextRef.current
        if (nextAssistant === null && nextThinking === null) return
        updateRows(prev =>
          prev.map(r => {
            if (nextAssistant !== null && assistantId && r.id === assistantId && r.role === 'assistant') {
              const next = splitStreamingContent(nextAssistant)
              return { ...r, content: next.committed, liveTail: next.liveTail }
            }
            if (nextThinking !== null && thinkingRowId && r.id === thinkingRowId && r.role === 'thinking') {
              const next = splitStreamingContent(nextThinking)
              return { ...r, content: next.committed, liveTail: next.liveTail }
            }
            return r
          }),
        )
        pendingAssistantTextRef.current = null
        pendingThinkingTextRef.current = null
      }

      if (immediate) {
        if (streamFlushTimerRef.current) {
          clearTimeout(streamFlushTimerRef.current)
          streamFlushTimerRef.current = null
        }
        commit()
        return
      }

      if (streamFlushTimerRef.current) return
      streamFlushTimerRef.current = setTimeout(commit, streamFlushMs)
    }

    try {
      for await (const ev of runTurn(provider, workingMessages, controller.signal)) {
        if (ev.type === 'text') {
          ensureAssistantRow()
          accumulated += ev.delta
          pendingAssistantTextRef.current = accumulated
          flushStreamRows()
        } else if (ev.type === 'thinking') {
          thinkingContent += ev.delta
          if (thinkingRowId === null) {
            const newId = nextRowId()
            thinkingRowId = newId
            updateRows(prev => {
              const idx = assistantId ? prev.findIndex(r => r.id === assistantId) : -1
              const row: MessageRow = { role: 'thinking', id: newId, content: '', liveTail: thinkingContent, streaming: true }
              if (idx === -1) return [...prev, row]
              return [...prev.slice(0, idx), row, ...prev.slice(idx)]
            })
          } else {
            pendingThinkingTextRef.current = thinkingContent
            flushStreamRows()
          }
        } else if (ev.type === 'tool_use_stop') {
          pendingToolUses.push({ id: ev.id, name: ev.name, input: ev.input })
        } else if (ev.type === 'error') {
          errored = true
          pushNote(ev.message, 'error')
          break
        } else if (ev.type === 'cancelled') {
          cancelled = true
          break
        } else if (ev.type === 'done') {
          break
        }
      }
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        errored = true
        pushNote((err as Error).message || 'stream error', 'error')
      }
    }

    flushStreamRows(true)
    updateRows(prev => {
      let next = prev.map(r => {
        if (assistantId && r.id === assistantId && r.role === 'assistant') {
          return { ...r, content: accumulated || r.content, liveTail: undefined, streaming: false }
        }
        if (thinkingRowId && r.id === thinkingRowId && r.role === 'thinking') {
          return { ...r, content: thinkingContent || r.content, liveTail: undefined, streaming: false }
        }
        return r
      })
      if (assistantId && accumulated.length === 0) {
        next = next.filter(r => r.id !== assistantId)
      }
      return next
    })

    const normalization = pendingToolUses.length > 0
      ? { toolUses: [], repairStatus: 'none' as const }
      : normalizeToolWorkFromAssistant(userText, accumulated)

    if (pendingToolUses.length === 0 && normalization.toolUses.length > 0) {
      pendingToolUses.push(...normalization.toolUses)
    }

    const hasToolWork = pendingToolUses.length > 0
    const shouldRetryNow =
      !hasToolWork &&
      toolRetryCount < 2 &&
      (
        normalization.repairStatus === 'failed' ||
        shouldForceToolRetry(userText, accumulated, provider.supportsTools)
      )

    if (hasToolWork && assistantId) {
      updateRows(prev => prev.filter(r => r.id !== assistantId))
    } else if (normalization.repairStatus === 'failed' && assistantId && !shouldRetryNow) {
      updateRows(prev => [
        ...prev.filter(r => r.id !== assistantId),
        {
          role: 'tool_result',
          id: nextRowId(),
          name: 'tool_repair',
          summary: normalization.repairMessage || 'tool repair failed',
          content: 'raw malformed output was hidden to keep the transcript readable',
          isError: true,
        },
      ])
    } else if (accumulated && !errored && !shouldRetryNow) {
      await persistTurnMessage({
        role: 'assistant',
        content: accumulated,
        createdAt: nowIso(),
        model: getConfig().model,
      })
      workingMessages.push({ role: 'assistant', content: accumulated })
    }

    if (controller.signal.aborted || cancelled) {
      cancelled = true
      break
    }
    if (errored) break

    if (shouldRetryNow) {
      toolRetryCount += 1
      if (assistantId) {
        updateRows(prev => prev.filter(r => r.id !== assistantId))
      }
      pushNote('retrying with a stricter tool directive so the model writes files directly.', 'dim')
      workingMessages = [
        ...workingMessages,
        { role: 'user', content: buildToolRetryPrompt(getDisplayCwd()) },
      ]
      continue
    }

    if (hasToolWork) {
      workingMessages.push({
        role: 'assistant',
        content: pendingToolUses.map(toolUse => ({
          type: 'tool_use' as const,
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        })),
      })

      const toolStep = await executeToolUses({
        pendingToolUses,
        nextRowId,
        nowIso,
        mode,
        getCwd,
        getConfig,
        controller,
        updateRows,
        pushNote,
        persistTurnMessage,
        executeTool,
        applySessionRule,
      })

      if (toolStep.cancelled) {
        cancelled = true
        break
      }
      if (toolStep.retryMessages) {
        toolRetryCount += 1
        workingMessages = [...workingMessages, ...toolStep.retryMessages]
        continue
      }

      workingMessages = buildWorkingMessages(context)
      continue
    }

    finishedNormally = true
    break
  }

  if (cancelled || controller.signal.aborted) pushNote('(cancelled)', 'dim')
  setStreaming(false)
  setActiveCheckpoint(undefined)

  return {
    finishedNormally,
    cancelled,
    shouldCompact: finishedNormally && shouldAutoCompact(workingMessages, getConfig().model),
  }
}

export async function runDirectToolIntent(context: {
  mode: SessionMode
  userText: string
  sessionId: string
  nextRowId: () => string
  nowIso: () => string
  updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => void
  persistTurnMessage: (message: SessionMessage) => Promise<void>
  executeTool: (
    name: string,
    input: Record<string, unknown>,
    mode: ReturnType<typeof toPermissionMode>,
  ) => Promise<ExecuteToolResult>
  applySessionRule: (rule?: SessionPermissionRule, persistRule?: boolean) => Promise<void>
  setActiveCheckpoint: (checkpoint: TurnCheckpoint | undefined) => void
}): Promise<boolean> {
  const directoryChange = detectDirectoryChangeIntent(context.userText)
  const deleteIntent = detectDeleteFileIntent(context.userText)
  if ((!directoryChange && !deleteIntent) || context.mode === 'plan') return false

  context.setActiveCheckpoint(createTurnCheckpoint(context.sessionId, context.userText))
  context.updateRows(prev => [...prev, { role: 'user', id: context.nextRowId(), content: context.userText }])
  await context.persistTurnMessage({ role: 'user', content: context.userText, createdAt: context.nowIso() })

  const toolUseId = `direct-${Date.now()}`
  const toolName = directoryChange ? 'change_directory' : 'run_bash'
  const toolInput = directoryChange
    ? { path: directoryChange.path }
    : { command: buildDeleteCommand(deleteIntent!.path) }

  context.updateRows(prev => [
    ...prev,
    {
      role: 'tool_use',
      id: context.nextRowId(),
      name: toolName,
      summary: toolName,
      input: summarizeToolInput(toolInput),
    },
  ])
  await context.persistTurnMessage({
    version: 2,
    role: 'tool_use',
    toolUseId,
    name: toolName,
    input: toolInput,
    createdAt: context.nowIso(),
  })

  const { result, sessionRule, persistRule } = await context.executeTool(
    toolName,
    toolInput,
    toPermissionMode(context.mode),
  )

  await context.applySessionRule(sessionRule, persistRule)

  context.updateRows(prev => [
    ...prev,
    {
      role: 'tool_result',
      id: context.nextRowId(),
      name: toolName,
      summary: result.summary,
      content: truncateForRow(result.content),
      isError: !result.ok,
    },
  ])
  await context.persistTurnMessage({
    version: 2,
    role: 'tool_result',
    toolUseId,
    name: toolName,
    content: result.content,
    isError: !result.ok,
    createdAt: context.nowIso(),
  })

  context.setActiveCheckpoint(undefined)
  return true
}

function buildWorkingMessages(context: Pick<TurnOrchestratorContext, 'getSessionMessages' | 'getConfig' | 'provider' | 'getCwd'>): Message[] {
  return buildBaseMessages(
    [...context.getSessionMessages()],
    context.getConfig(),
    context.provider.supportsTools,
    context.getCwd(),
  )
}

async function executeToolUses(args: {
  pendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>
  nextRowId: () => string
  nowIso: () => string
  mode: SessionMode
  getCwd: () => string
  getConfig: () => EthagentConfig
  controller: AbortController
  updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => void
  pushNote: (text: string, kind?: 'info' | 'error' | 'dim') => void
  persistTurnMessage: (message: SessionMessage) => Promise<void>
  executeTool: (
    name: string,
    input: Record<string, unknown>,
    mode: ReturnType<typeof toPermissionMode>,
  ) => Promise<ExecuteToolResult>
  applySessionRule: (rule?: SessionPermissionRule, persistRule?: boolean) => Promise<void>
}): Promise<{ cancelled: boolean; retryMessages?: Message[] }> {
  for (const toolUse of args.pendingToolUses) {
    args.updateRows(prev => [
      ...prev,
      { role: 'tool_use', id: args.nextRowId(), name: toolUse.name, summary: toolUse.name, input: summarizeToolInput(toolUse.input) },
    ])
    await args.persistTurnMessage({
      version: 2,
      role: 'tool_use',
      toolUseId: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      createdAt: args.nowIso(),
    })

    const { result, sessionRule, persistRule } = await args.executeTool(
      toolUse.name,
      toolUse.input,
      toPermissionMode(args.mode),
    )

    if (args.controller.signal.aborted) {
      return { cancelled: true }
    }

    if (shouldRetryRejectedToolInput(result)) {
      args.pushNote(`retrying ${toolUse.name} with stricter arguments after a schema validation failure.`, 'dim')
      return {
        cancelled: false,
        retryMessages: [{
          role: 'user',
          content: buildToolInputRepairPrompt(
            args.getCwd(),
            toolUse.name,
            result.content,
          ),
        }],
      }
    }

    await args.applySessionRule(sessionRule, persistRule)

    args.updateRows(prev => [
      ...prev,
      {
        role: 'tool_result',
        id: args.nextRowId(),
        name: toolUse.name,
        summary: result.summary,
        content: truncateForRow(result.content),
        isError: !result.ok,
      },
    ])
    await args.persistTurnMessage({
      version: 2,
      role: 'tool_result',
      toolUseId: toolUse.id,
      name: toolUse.name,
      content: result.content,
      isError: !result.ok,
      createdAt: args.nowIso(),
    })
  }

  return { cancelled: false }
}
