import fs from 'node:fs/promises'
import path from 'node:path'
import type { Message, Provider } from '../providers/contracts.js'
import { directToolUsesForUserText } from '../runtime/toolIntent.js'
import { toPermissionMode, type SessionMode } from '../runtime/sessionMode.js'
import { runPendingToolUses } from '../runtime/toolExecution.js'
import { runRuntimeTurn, type TurnEvent } from '../runtime/turn.js'
import type { EthagentConfig } from '../storage/config.js'
import type { SessionMessage } from '../storage/sessions.js'
import type { SessionPermissionRule, ToolResult } from '../tools/contracts.js'
import { readContinuityFiles } from '../identity/continuity/storage.js'
import { listSkillsTree } from '../identity/continuity/skills/loadSkills.js'
import { isDraftScaffold } from '../identity/continuity/skills/scaffold.js'
import type { MessageRow } from './MessageList.js'
import {
  buildBaseMessages,
  createTurnCheckpoint,
  type TurnCheckpoint,
} from './chatScreenUtils.js'
import { collapseImagePathsToRefs, userTextToContentBlocks } from '../utils/images.js'

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
  preflightProvider?: () => Promise<{ ok: true } | { ok: false; message: string }>
  onPlanReady?: (plan: string) => void
  pendingAssistantTextRef: MutableRef<string | null>
  pendingThinkingTextRef: MutableRef<string | null>
  streamFlushTimerRef: MutableRef<ReturnType<typeof setTimeout> | null>
}

export type StreamingTurnResult = {
  finishedNormally: boolean
  cancelled: boolean
}

export async function runStreamingTurn(
  context: TurnOrchestratorContext,
): Promise<StreamingTurnResult> {
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
    setActiveCheckpoint,
    setStreaming,
    updateRows,
    pushNote,
    persistTurnMessage,
    executeTool,
    applySessionRule,
    preflightProvider,
    onPlanReady,
    pendingAssistantTextRef,
    pendingThinkingTextRef,
    streamFlushTimerRef,
  } = context

  if (mode === 'accept-edits') {
    pushNote(
      provider.supportsTools
        ? 'accept-edits mode: workspace reads/edits auto-allow. private continuity edits and bash still prompt.'
        : 'accept-edits mode selected, but the current provider does not support tools yet.',
      'dim',
    )
  }

  setStreaming(true)
  const activeCheckpoint = createTurnCheckpoint(sessionId, userText)
  setActiveCheckpoint(activeCheckpoint)

  const userContent = userTextToContentBlocks(userText)
  const displayText = collapseImagePathsToRefs(userText)
  updateRows(prev => [...prev, { role: 'user', id: nextRowId(), content: displayText }])
  await persistTurnMessage({
    role: 'user',
    content: displayText,
    providerContent: typeof userContent === 'string' ? undefined : userContent,
    createdAt: nowIso(),
    turnId: activeCheckpoint.turnId,
  })

  const mentionContextMessages = await buildFileMentionContextMessages(userText, getCwd())

  const buildWorking = async (): Promise<Message[]> => {
    const baseMessages = buildWorkingMessages(context, activeCheckpoint.turnId)
    const [baseSystem, ...conversationMessages] = baseMessages
    return [
      ...(baseSystem ? [baseSystem] : []),
      ...await buildIdentityContinuityContextMessages(getConfig()),
      ...await buildSkillsIndexMessage(getConfig()),
      ...conversationMessages,
      ...mentionContextMessages,
    ]
  }

  let accumulated = ''
  let thinkingContent = ''
  let thinkingRowId: string | null = null
  let thinkingCursorActive = false
  let assistantId: string | null = null

  const resetIteration = () => {
    accumulated = ''
    thinkingContent = ''
    thinkingRowId = null
    thinkingCursorActive = false
    assistantId = null
  }

  const stopThinkingCursor = () => {
    if (!thinkingRowId || !thinkingCursorActive) return
    thinkingCursorActive = false
    updateRows(prev => prev.map(row =>
      row.id === thinkingRowId && row.role === 'thinking'
        ? { ...row, showCursor: false }
        : row,
    ))
  }

  const ensureAssistantRow = (): string => {
    if (assistantId) return assistantId
    assistantId = nextRowId()
    updateRows(prev => [
      ...prev,
      { role: 'assistant', id: assistantId!, content: '', liveTail: '', streaming: true },
    ])
    return assistantId
  }

  const flushStreamRows = (immediate = false) => {
    const commit = () => {
      streamFlushTimerRef.current = null
      const nextAssistant = pendingAssistantTextRef.current
      const nextThinking = pendingThinkingTextRef.current
      if (nextAssistant === null && nextThinking === null) return
      updateRows(prev => updateStreamingRows(
        prev,
        assistantId,
        thinkingRowId,
        nextAssistant,
        nextThinking,
      ))
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

  const finalizeStreamingRows = () => {
    flushStreamRows(true)
    updateRows(prev => {
      let next = finalizeStreamingRowsById(prev, assistantId, thinkingRowId, accumulated, thinkingContent)
      if (assistantId && accumulated.length === 0) {
        next = next.filter(r => r.id !== assistantId)
      }
      return next
    })
  }

  const discardStreamingRows = () => {
    flushStreamRows(true)
    updateRows(prev => prev.filter(row =>
      !(assistantId && row.id === assistantId)
      && !(thinkingRowId && row.id === thinkingRowId),
    ))
    pendingAssistantTextRef.current = null
    pendingThinkingTextRef.current = null
  }

  let finishedNormally = false
  let cancelled = false

  const runToolBatch = async (pendingToolUses: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>) => {
    const step = await runPendingToolUses({
      pendingToolUses,
      nextRowId,
      nowIso,
      mode,
      getCwd,
      getConfig,
      turnId: activeCheckpoint.turnId,
      controller,
      updateRows,
      pushNote,
      persistTurnMessage,
      executeTool,
      applySessionRule,
    })
    return step
  }

  const directToolUses = provider.supportsTools
    ? directToolUsesForUserText(userText)
    : []
  if (directToolUses.length > 0) {
    const step = await runToolBatch(directToolUses)
    const directCancelled = step.cancelled || controller.signal.aborted
    if (directCancelled) pushNote('(cancelled)', 'dim')
    setStreaming(false)
    setActiveCheckpoint(undefined)
    return {
      finishedNormally: !directCancelled,
      cancelled: directCancelled,
    }
  }

  if (preflightProvider) {
    let preflight: { ok: true } | { ok: false; message: string }
    try {
      preflight = await preflightProvider()
    } catch (err: unknown) {
      preflight = {
        ok: false,
        message: `provider preflight failed: ${(err as Error).message || 'unknown error'}`,
      }
    }
    if (!preflight.ok) {
      pushNote(preflight.message, 'error')
      setStreaming(false)
      setActiveCheckpoint(undefined)
      return {
        finishedNormally: false,
        cancelled: controller.signal.aborted,
      }
    }
  }

  try {
    for await (const ev of runRuntimeTurn({
      provider,
      signal: controller.signal,
      initialMessages: await buildWorking(),
      rebuildMessages: buildWorking,
      runToolBatch,
    })) {
      cancelled = cancelled || isCancelledEvent(ev)
      await handleEvent(ev, {
        ensureAssistantRow,
        flushStreamRows,
        finalizeStreamingRows,
        discardStreamingRows,
        resetIteration,
        stopThinkingCursor,
        setAccumulated: text => { accumulated = text },
        getAccumulated: () => accumulated,
        setThinkingContent: text => { thinkingContent = text },
        getThinkingContent: () => thinkingContent,
        setThinkingRowId: id => { thinkingRowId = id },
        markThinkingCursorActive: () => { thinkingCursorActive = true },
        getThinkingRowId: () => thinkingRowId,
        updateRows,
        pushNote,
        nextRowId,
        pendingAssistantTextRef,
        pendingThinkingTextRef,
        persistTurnMessage,
        nowIso,
        mode,
        onPlanReady,
        turnId: activeCheckpoint.turnId,
        model: getConfig().model,
        onFinishedNormally: () => { finishedNormally = true },
      })
    }
  } catch (err: unknown) {
    if (!controller.signal.aborted) {
      pushNote((err as Error).message || 'stream error', 'error')
    }
    finalizeStreamingRows()
  }

  if (cancelled || controller.signal.aborted) pushNote('(cancelled)', 'dim')
  setStreaming(false)
  setActiveCheckpoint(undefined)

  return {
    finishedNormally,
    cancelled,
  }
}

type EventHandlerContext = {
  ensureAssistantRow: () => string
  flushStreamRows: (immediate?: boolean) => void
  finalizeStreamingRows: () => void
  discardStreamingRows: () => void
  resetIteration: () => void
  stopThinkingCursor: () => void
  setAccumulated: (text: string) => void
  getAccumulated: () => string
  setThinkingContent: (text: string) => void
  getThinkingContent: () => string
  setThinkingRowId: (id: string | null) => void
  getThinkingRowId: () => string | null
  markThinkingCursorActive: () => void
  updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => void
  pushNote: (text: string, kind?: 'info' | 'error' | 'dim') => void
  nextRowId: () => string
  pendingAssistantTextRef: MutableRef<string | null>
  pendingThinkingTextRef: MutableRef<string | null>
  persistTurnMessage: (message: SessionMessage) => Promise<void>
  nowIso: () => string
  mode: SessionMode
  onPlanReady?: (plan: string) => void
  turnId: string
  model: string
  onFinishedNormally: () => void
}

function isCancelledEvent(ev: TurnEvent): boolean {
  return ev.type === 'cancelled'
}

async function handleEvent(ev: TurnEvent, ctx: EventHandlerContext): Promise<void> {
  switch (ev.type) {
    case 'iteration_start': {
      ctx.resetIteration()
      return
    }
    case 'text': {
      ctx.stopThinkingCursor()
      ctx.ensureAssistantRow()
      const next = ctx.getAccumulated() + ev.delta
      ctx.setAccumulated(next)
      ctx.pendingAssistantTextRef.current = next
      ctx.flushStreamRows()
      return
    }
    case 'thinking': {
      const current = ctx.getThinkingContent()
      const appended = current + ev.delta
      ctx.setThinkingContent(appended)
      if (ctx.getThinkingRowId() === null) {
        const id = ctx.nextRowId()
        ctx.setThinkingRowId(id)
        ctx.markThinkingCursorActive()
        ctx.updateRows(prev => [
          ...prev,
          {
            role: 'thinking',
            id,
            content: '',
            liveTail: appended,
            streaming: true,
            expanded: false,
            showCursor: true,
          },
        ])
      }
      ctx.pendingThinkingTextRef.current = appended
      ctx.flushStreamRows()
      return
    }
    case 'thinking_end': {
      ctx.flushStreamRows(true)
      ctx.stopThinkingCursor()
      return
    }
    case 'retry': {
      return
    }
    case 'tool_use_stop': {
      ctx.finalizeStreamingRows()
      return
    }
    case 'assistant_message_committed': {
      ctx.finalizeStreamingRows()
      if (ev.text) {
        await ctx.persistTurnMessage({
          role: 'assistant',
          content: ev.text,
          createdAt: ctx.nowIso(),
          model: ctx.model,
          turnId: ctx.turnId,
        })
        if (ctx.mode === 'plan') ctx.onPlanReady?.(ev.text)
      }
      return
    }
    case 'tool_executed': {
      return
    }
    case 'local_tool_recovery': {
      ctx.discardStreamingRows()
      return
    }
    case 'continuation_nudge': {
      if (
        ev.reason === 'tool_state_claim' ||
        ev.reason === 'tool_capability' ||
        ev.reason === 'tool_protocol_fake' ||
        ev.reason === 'tool_delegation'
      ) {
        ctx.discardStreamingRows()
      } else {
        ctx.finalizeStreamingRows()
      }
      ctx.resetIteration()
      return
    }
    case 'error': {
      ctx.pushNote(ev.message, 'error')
      if (ev.discardAssistant) {
        ctx.discardStreamingRows()
      } else {
        ctx.finalizeStreamingRows()
      }
      return
    }
    case 'cancelled': {
      ctx.finalizeStreamingRows()
      return
    }
    case 'done': {
      ctx.finalizeStreamingRows()
      if (ev.finishedNormally) ctx.onFinishedNormally()
      return
    }
    case 'tool_use_start':
    case 'tool_use_delta':
      return
  }
}

function updateStreamingRows(
  rows: MessageRow[],
  assistantId: string | null,
  thinkingRowId: string | null,
  assistantText: string | null,
  thinkingText: string | null,
): MessageRow[] {
  let next: MessageRow[] | null = null
  if (assistantId && assistantText !== null) {
    const index = findRowIndexById(rows, assistantId)
    const row = rows[index]
    if (row?.role === 'assistant') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: assistantText, liveTail: '' }
    }
  }
  const source = next ?? rows
  if (thinkingRowId && thinkingText !== null) {
    const index = findRowIndexById(source, thinkingRowId)
    const row = source[index]
    if (row?.role === 'thinking') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: thinkingText, liveTail: '' }
    }
  }
  return next ?? rows
}

function finalizeStreamingRowsById(
  rows: MessageRow[],
  assistantId: string | null,
  thinkingRowId: string | null,
  assistantText: string,
  thinkingText: string,
): MessageRow[] {
  let next: MessageRow[] | null = null
  if (assistantId) {
    const index = findRowIndexById(rows, assistantId)
    const row = rows[index]
    if (row?.role === 'assistant') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: assistantText || row.content, liveTail: undefined, streaming: false }
    }
  }
  const source = next ?? rows
  if (thinkingRowId) {
    const index = findRowIndexById(source, thinkingRowId)
    const row = source[index]
    if (row?.role === 'thinking') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: thinkingText || row.content, liveTail: undefined, streaming: false, showCursor: false }
    }
  }
  return next ?? rows
}

function findRowIndexById(rows: MessageRow[], id: string): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.id === id) return index
  }
  return -1
}

async function buildFileMentionContextMessages(
  userText: string,
  cwd: string,
): Promise<Message[]> {
  const mentions = extractFileMentions(userText)
  if (mentions.length === 0) return []

  const lines: string[] = []
  for (const mention of mentions) {
    const resolved = path.resolve(cwd, mention)
    const rel = path.relative(cwd, resolved)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      lines.push(
        `@${mention} -> outside current workspace; do not use unless the user changes directory or names an allowed path.`,
      )
      continue
    }
    try {
      const stats = await fs.stat(resolved)
      lines.push(`@${mention} -> ${mention} (${stats.isDirectory() ? 'directory' : 'file'})`)
    } catch {
      lines.push(`@${mention} -> unresolved`)
    }
  }

  return [
    {
      role: 'user',
      content: [
        'Resolved file mentions for this request:',
        ...lines,
        'Treat these mentions as authoritative filenames from the user request. Read referenced context files when needed, and edit only the file requested by the user or the target file you have inspected.',
      ].join('\n'),
    },
  ]
}

const PRIVATE_SKILLS_INDEX_BUDGET = 2048

export async function buildSkillsIndexMessage(
  config: EthagentConfig,
): Promise<Message[]> {
  const identity = config.identity
  if (!identity) return []
  try {
    const { skills, supportingCounts } = await listSkillsTree(identity)
    const entries = skills.filter(entry => !isDraftScaffold(entry))
    if (entries.length === 0) return []
    const header = [
      '<private_skills index="true" visibility="private">',
      'Private skills are owner-authored content packs available for this active identity.',
      'Each line shows skill_name — description. When an entry ends with (+N supporting files), call list_private_skill_files to see relative + absolute paths for each file. Read text content via read_private_skill with file:; run executable supporting scripts with run_bash using the absolute path returned by list_private_skill_files. Call list_private_skills for the full index.',
    ]
    const lines: string[] = []
    let charCount = header.reduce((sum, line) => sum + line.length + 1, 0)
    let included = 0
    let dropped = 0
    for (const entry of entries) {
      const displayName = entry.displayName ?? entry.name
      const desc = entry.description ? ` — ${entry.description}` : ''
      const hint = entry.whenToUse ? ` (when: ${entry.whenToUse})` : ''
      const supporting = supportingCounts[entry.name] ?? 0
      const trailer = supporting > 0
        ? ` (+${supporting} supporting file${supporting === 1 ? '' : 's'})`
        : ''
      const line = `- ${displayName}${desc}${hint}${trailer}`
      if (charCount + line.length + 1 > PRIVATE_SKILLS_INDEX_BUDGET && included > 0) {
        dropped = entries.length - included
        break
      }
      lines.push(line)
      charCount += line.length + 1
      included++
    }
    const footer: string[] = []
    if (dropped > 0) {
      footer.push(`(${dropped} more — call list_private_skills to enumerate)`)
    }
    footer.push('</private_skills>')
    return [{
      role: 'system',
      content: [...header, ...lines, ...footer].join('\n'),
    }]
  } catch {
    return []
  }
}

export async function buildIdentityContinuityContextMessages(
  config: EthagentConfig,
): Promise<Message[]> {
  const identity = config.identity
  if (!identity) return []

  try {
    const privateFiles = await readContinuityFiles(identity)
    const parts: string[] = [
      '<identity_continuity_files>',
      'The active identity continuity files have been loaded automatically for this turn.',
      'SOUL.md is private owner continuity and is the authoritative persona, voice, and standing-behavior layer for this active identity.',
      'MEMORY.md is private owner continuity for durable preferences, facts, and project context.',
      'Apply SOUL.md and MEMORY.md over generic ethagent identity/style unless they conflict with safety, tool correctness, developer instructions, or the user\'s latest explicit request. Do not quote private continuity unless necessary.',
      '<SOUL.md visibility="private">',
      privateFiles['SOUL.md'].trimEnd(),
      '</SOUL.md>',
      '',
      '<MEMORY.md visibility="private">',
      privateFiles['MEMORY.md'].trimEnd(),
      '</MEMORY.md>',
      '</identity_continuity_files>',
    ]
    return [{
      role: 'system',
      content: parts.join('\n'),
    }]
  } catch (err: unknown) {
    return [{
      role: 'system',
      content: [
        '<identity_continuity_files>',
        `Automatic identity continuity load failed: ${(err as Error).message}`,
        'If the user asks about continuity, surface this failure and route them to the Identity Hub.',
        '</identity_continuity_files>',
      ].join('\n'),
    }]
  }
}

function extractFileMentions(text: string): string[] {
  const mentions = new Set<string>()
  for (const match of text.matchAll(/@([^\s]+)/g)) {
    const raw = match[1]?.replace(/[),.;:!?]+$/g, '')
    if (!raw || raw.length === 0) continue
    mentions.add(raw.replace(/\\/g, '/'))
  }
  return [...mentions]
}

function buildWorkingMessages(
  context: Pick<
    TurnOrchestratorContext,
    'getSessionMessages' | 'getConfig' | 'provider' | 'getCwd' | 'mode'
  >,
  preserveTurnId?: string,
): Message[] {
  const config = context.getConfig()
  return buildBaseMessages(
    [...context.getSessionMessages()],
    config,
    context.provider.supportsTools,
    context.getCwd(),
    context.mode,
    { preserveTurnId },
  )
}
