import type { Message, Provider } from '../providers/contracts.js'
import { approximateTokens, messageTextContent } from '../utils/messages.js'
import type { SessionMessage } from '../storage/sessions.js'

const COMPACT_SYSTEM = `Create a continuation handoff for this coding-agent conversation.
Keep it concise but complete. Preserve the current goal, user constraints, key decisions, relevant files, tool results, pending tasks, and known failures. Do not claim unverified work was completed. No preamble.`

const LOCAL_COMPACTION_INPUT_TOKENS = 6_000
const CLOUD_COMPACTION_INPUT_TOKENS = 24_000
const LOCAL_COMPACTION_OUTPUT_TOKENS = 1_000
const CLOUD_COMPACTION_OUTPUT_TOKENS = 1_600
const LOCAL_RECENT_MESSAGE_COUNT = 28
const CLOUD_RECENT_MESSAGE_COUNT = 80
const LOCAL_MESSAGE_CHAR_LIMIT = 900
const CLOUD_MESSAGE_CHAR_LIMIT = 2_000

export type CompactionStage =
  | 'preparing transcript'
  | 'compressing long context'
  | 'summarizing with local model'
  | 'summarizing with provider'

export type CompactTranscriptOptions = {
  signal?: AbortSignal
  onStage?: (stage: CompactionStage) => void
  maxInputTokens?: number
  maxOutputTokens?: number
}

export type CompactTranscriptResult =
  | { ok: true; summary: string; inputTokens: number; compressed: boolean }
  | { ok: false; reason: string; cancelled?: boolean; inputTokens?: number; compressed?: boolean }

export type CompactionSource = {
  text: string
  inputTokens: number
  compressed: boolean
}

export type ContextWindowConfidence = 'exact' | 'inferred' | 'fallback'

export type ContextWindowInfo = {
  tokens: number
  confidence: ContextWindowConfidence
  source: string
}

export type ContextUsage = {
  usedTokens: number
  windowTokens: number
  percent: number
  confidence: ContextWindowConfidence
  source: string
}

export function contextWindow(model: string): number {
  return contextWindowInfo('', model).tokens
}

export function contextWindowInfo(provider: string, model: string): ContextWindowInfo {
  const lower = model.toLowerCase()
  const providerLower = provider.toLowerCase()
  if (lower.startsWith('qwen3:4b') || lower.startsWith('qwen3:30b') || lower.startsWith('qwen3:235b')) {
    return { tokens: 256_000, confidence: 'inferred', source: 'qwen3 long-context tag' }
  }
  if (lower.includes('qwen3')) {
    return { tokens: 40_000, confidence: 'inferred', source: 'qwen3 default' }
  }
  if (lower.includes('qwen')) {
    return { tokens: 32_768, confidence: 'inferred', source: 'qwen default' }
  }
  if (lower.includes('llama3')) {
    return { tokens: 128_000, confidence: 'inferred', source: 'llama3 family default' }
  }
  if (providerLower === 'anthropic' || lower.includes('claude')) {
    return { tokens: 200_000, confidence: 'inferred', source: 'claude family default' }
  }
  if (providerLower === 'gemini' || lower.includes('gemini')) {
    return { tokens: 1_000_000, confidence: 'inferred', source: 'gemini family default' }
  }
  if (
    lower.includes('gpt-4.1')
  ) {
    return { tokens: 1_000_000, confidence: 'inferred', source: 'gpt-4.1 family default' }
  }
  if (
    providerLower === 'openai'
    || lower.includes('gpt-4o')
    || /^o[134](?:-|$)/.test(lower)
  ) {
    return { tokens: 128_000, confidence: 'inferred', source: 'openai chat default' }
  }
  return { tokens: 128_000, confidence: 'fallback', source: 'ethagent fallback' }
}

export function contextUsage(messages: Message[], provider: string, model: string): ContextUsage {
  return contextUsageFromTokens(approximateTokens(messages), provider, model)
}

export function contextUsageFromTokens(tokens: number, provider: string, model: string): ContextUsage {
  const info = contextWindowInfo(provider, model)
  const usedTokens = Math.max(0, Math.ceil(tokens))
  return {
    usedTokens,
    windowTokens: info.tokens,
    percent: info.tokens > 0 ? Math.round((usedTokens / info.tokens) * 100) : 0,
    confidence: info.confidence,
    source: info.source,
  }
}

export function shouldConfirmContextUsage(usage: Pick<ContextUsage, 'percent'>, thresholdPercent = 90): boolean {
  return usage.percent >= thresholdPercent
}

export async function compactTranscript(
  provider: Provider,
  transcript: Message[],
  options: CompactTranscriptOptions = {},
): Promise<CompactTranscriptResult> {
  const nonSystem = transcript.filter(m => m.role !== 'system')
  if (nonSystem.length < 2) {
    return { ok: false, reason: 'not enough turns to compact' }
  }

  options.onStage?.('preparing transcript')
  const source = buildCompactionSource(transcript, provider.id, {
    maxInputTokens: options.maxInputTokens,
  })
  if (source.compressed) options.onStage?.('compressing long context')

  const prompt: Message[] = [
    { role: 'system', content: COMPACT_SYSTEM },
    { role: 'user', content: `Create a continuation handoff from this conversation context:\n\n${source.text}` },
  ]

  const controller = options.signal ? null : new AbortController()
  const signal = options.signal ?? controller!.signal
  let summary = ''
  const local = isLocalProviderId(provider.id)
  options.onStage?.(local ? 'summarizing with local model' : 'summarizing with provider')
  try {
    for await (const ev of provider.complete(prompt, signal, {
      maxTokens: options.maxOutputTokens ?? (local ? LOCAL_COMPACTION_OUTPUT_TOKENS : CLOUD_COMPACTION_OUTPUT_TOKENS),
    })) {
      if (signal.aborted) return { ok: false, reason: 'cancelled', cancelled: true, inputTokens: source.inputTokens, compressed: source.compressed }
      if (ev.type === 'text') summary += ev.delta
      else if (ev.type === 'error') return { ok: false, reason: ev.message }
      else if (ev.type === 'done') break
    }
  } catch (err: unknown) {
    if (signal.aborted) return { ok: false, reason: 'cancelled', cancelled: true, inputTokens: source.inputTokens, compressed: source.compressed }
    return { ok: false, reason: (err as Error).message || 'compact stream error' }
  }

  if (signal.aborted) return { ok: false, reason: 'cancelled', cancelled: true, inputTokens: source.inputTokens, compressed: source.compressed }
  summary = summary.trim()
  if (summary.length < 40) return { ok: false, reason: 'summary too short', inputTokens: source.inputTokens, compressed: source.compressed }

  return { ok: true, summary, inputTokens: source.inputTokens, compressed: source.compressed }
}

export function buildCompactionSource(
  transcript: Message[],
  providerId: Provider['id'],
  options: { maxInputTokens?: number } = {},
): CompactionSource {
  const nonSystem = transcript.filter(m => m.role !== 'system')
  const local = isLocalProviderId(providerId)
  const tokenBudget = options.maxInputTokens ?? (local ? LOCAL_COMPACTION_INPUT_TOKENS : CLOUD_COMPACTION_INPUT_TOKENS)
  const charBudget = Math.max(1_000, tokenBudget * 4)
  const recentMessageCount = local ? LOCAL_RECENT_MESSAGE_COUNT : CLOUD_RECENT_MESSAGE_COUNT
  const messageCharLimit = local ? LOCAL_MESSAGE_CHAR_LIMIT : CLOUD_MESSAGE_CHAR_LIMIT
  const rawTokenEstimate = approximateTokens(nonSystem)
  const mustCompress = rawTokenEstimate > tokenBudget || nonSystem.length > recentMessageCount

  if (!mustCompress) {
    const text = nonSystem.map((message, index) =>
      formatCompactionMessage(message, index + 1, messageCharLimit),
    ).join('\n\n')
    return {
      text,
      inputTokens: approximateTextTokens(text),
      compressed: false,
    }
  }

  const recent = nonSystem.slice(-recentMessageCount)
  const earlier = nonSystem.slice(0, Math.max(0, nonSystem.length - recent.length))
  const parts: string[] = []
  parts.push('Deterministic pre-summary of earlier context:')
  parts.push(summarizeTranscriptLocally(earlier.length > 0 ? earlier : nonSystem, 'input was bounded before model summarization'))
  parts.push('')
  parts.push('Recent transcript excerpts:')
  parts.push(...recent.map((message, index) =>
    formatCompactionMessage(message, nonSystem.length - recent.length + index + 1, messageCharLimit),
  ))

  const bounded = limitCompactionText(parts.join('\n\n'), charBudget)
  return {
    text: bounded,
    inputTokens: approximateTextTokens(bounded),
    compressed: true,
  }
}

export function summarizeTranscriptLocally(
  transcript: Message[],
  reason?: string,
): string {
  const nonSystem = transcript.filter(m => m.role !== 'system')
  const userRequests: string[] = []
  const assistantReplies: string[] = []
  const toolNotes: string[] = []

  for (const message of nonSystem) {
    const text = oneLine(messageTextContent(message), 240)
    if (!text) continue
    if (message.role === 'user') userRequests.push(text)
    else if (message.role === 'assistant') assistantReplies.push(text)
    else toolNotes.push(`${message.role}: ${text}`)
  }

  const parts = [
    'Local conversation summary for continuation.',
    reason ? `Provider summary was unavailable: ${oneLine(reason, 180)}.` : '',
  ].filter(Boolean)

  if (userRequests.length > 0) {
    parts.push('Recent user requests:')
    parts.push(...userRequests.slice(-8).map(item => `- ${item}`))
  }
  if (assistantReplies.length > 0) {
    parts.push('Recent assistant progress:')
    parts.push(...assistantReplies.slice(-6).map(item => `- ${item}`))
  }
  if (toolNotes.length > 0) {
    parts.push('Recent tool context:')
    parts.push(...toolNotes.slice(-6).map(item => `- ${item}`))
  }
  parts.push('Continue from this summary, and verify current files or external state before relying on stale details.')

  return parts.join('\n')
}

export type MicroCompactOptions = {
  activeTurnId?: string
}

export type MicroCompactResult = {
  messages: SessionMessage[]
  compactedTurns: number
}

const RECENT_TURN_BUDGET = 15
const TRIGGER_MESSAGE_COUNT = 50

export function shouldMicroCompact(messages: SessionMessage[]): boolean {
  return messages.length > TRIGGER_MESSAGE_COUNT
}

export function microCompactSessionMessages(
  messages: SessionMessage[],
  options: MicroCompactOptions = {},
): MicroCompactResult {
  if (!shouldMicroCompact(messages)) {
    return { messages, compactedTurns: 0 }
  }

  const turnOrder: string[] = []
  const turnsSeen = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    const turnId = (message as { turnId?: string }).turnId
    if (!turnId || turnsSeen.has(turnId)) continue
    turnsSeen.add(turnId)
    turnOrder.push(turnId)
  }

  if (turnOrder.length <= RECENT_TURN_BUDGET) {
    return { messages, compactedTurns: 0 }
  }

  const keepTurnIds = new Set(turnOrder.slice(turnOrder.length - RECENT_TURN_BUDGET))
  if (options.activeTurnId) keepTurnIds.add(options.activeTurnId)

  const oldMessages: SessionMessage[] = []
  const kept: SessionMessage[] = []
  for (const message of messages) {
    const turnId = (message as { turnId?: string }).turnId
    if (!turnId) {
      kept.push(message)
      continue
    }
    if (keepTurnIds.has(turnId)) {
      kept.push(message)
    } else {
      oldMessages.push(message)
    }
  }

  if (oldMessages.length === 0) {
    return { messages, compactedTurns: 0 }
  }

  const compactedTurns = new Set(
    oldMessages
      .map(message => (message as { turnId?: string }).turnId)
      .filter((id): id is string => typeof id === 'string'),
  )

  const summary = summarizeCompactedTurns(oldMessages)
  const firstKeptIndex = messages.findIndex(m => kept.includes(m))
  const summaryMessage: SessionMessage = {
    role: 'assistant',
    content: summary,
    createdAt: oldMessages[oldMessages.length - 1]!.createdAt,
  }

  const out: SessionMessage[] = []
  if (firstKeptIndex > 0) {
    out.push(...messages.slice(0, firstKeptIndex).filter(m => !oldMessages.includes(m)))
  }
  out.push(summaryMessage)
  out.push(...kept)
  return { messages: out, compactedTurns: compactedTurns.size }
}

function summarizeCompactedTurns(messages: SessionMessage[]): string {
  const userRequests: string[] = []
  const assistantReplies: string[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const content = typeof message.content === 'string' ? message.content : ''
      if (content.trim()) userRequests.push(oneLine(content, 140))
    } else if (message.role === 'assistant') {
      const content = typeof message.content === 'string' ? message.content : ''
      if (content.trim()) assistantReplies.push(oneLine(content, 140))
    }
  }

  const parts = ['[Earlier conversation context was compacted to fit the model\'s context window.]']
  if (userRequests.length > 0) {
    const sample = userRequests.slice(-5)
    parts.push(`Most recent earlier user requests: ${sample.map(item => `"${item}"`).join('; ')}`)
  }
  if (assistantReplies.length > 0) {
    const last = assistantReplies[assistantReplies.length - 1]!
    parts.push(`Most recent earlier assistant reply: "${last}"`)
  }
  parts.push('Treat the above as background; respond to the current user message next.')
  return parts.join(' ')
}

function oneLine(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) return normalized
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`
}

function isLocalProviderId(providerId: Provider['id']): boolean {
  return providerId === 'llamacpp'
}

function formatCompactionMessage(message: Message, index: number, limit: number): string {
  const text = oneLine(messageTextContent(message), limit)
  return `${index}. ${message.role}: ${text || '[empty]'}`
}

function limitCompactionText(text: string, charBudget: number): string {
  if (text.length <= charBudget) return text
  const recentHeader = 'Recent transcript excerpts:'
  const recentIndex = text.indexOf(recentHeader)
  if (recentIndex !== -1) {
    const prefixEnd = recentIndex + recentHeader.length
    const prefix = text.slice(0, prefixEnd)
    const marker = '[Earlier recent transcript excerpts omitted to keep local summarization responsive.]'
    const tailBudget = Math.max(0, charBudget - prefix.length - marker.length - 4)
    return `${prefix}\n\n${marker}\n\n${text.slice(Math.max(prefixEnd, text.length - tailBudget))}`
  }
  const marker = '[Earlier bounded compaction text omitted to keep local summarization responsive.]'
  const tailBudget = Math.max(0, charBudget - marker.length - 2)
  return `${marker}\n\n${text.slice(Math.max(0, text.length - tailBudget))}`
}

function approximateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
