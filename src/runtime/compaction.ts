import type { Message, Provider } from '../providers/contracts.js'
import { approximateTokens, messageTextContent } from '../utils/messages.js'
import type { SessionMessage } from '../storage/sessions.js'

const COMPACT_SYSTEM = `Summarize this coding-agent conversation so work can continue in a new conversation.
Keep the summary concise but complete. Preserve the current goal, user constraints, key decisions, relevant files, tool results, pending tasks, and known failures. Do not claim unverified work was completed. No preamble.`

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
): Promise<{ ok: true; summary: string } | { ok: false; reason: string }> {
  const nonSystem = transcript.filter(m => m.role !== 'system')
  if (nonSystem.length < 2) {
    return { ok: false, reason: 'not enough turns to compact' }
  }

  const serialized = nonSystem.map(m => `${m.role}: ${messageTextContent(m)}`).join('\n\n')

  const prompt: Message[] = [
    { role: 'system', content: COMPACT_SYSTEM },
    { role: 'user', content: `Summarize this conversation for continuation in a new conversation:\n\n${serialized}` },
  ]

  const controller = new AbortController()
  let summary = ''
  try {
    for await (const ev of provider.complete(prompt, controller.signal)) {
      if (ev.type === 'text') summary += ev.delta
      else if (ev.type === 'error') return { ok: false, reason: ev.message }
      else if (ev.type === 'done') break
    }
  } catch (err: unknown) {
    return { ok: false, reason: (err as Error).message || 'compact stream error' }
  }

  summary = summary.trim()
  if (summary.length < 40) return { ok: false, reason: 'summary too short' }

  return { ok: true, summary }
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
