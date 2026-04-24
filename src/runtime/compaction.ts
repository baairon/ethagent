import type { Message, Provider } from '../providers/contracts.js'
import { approximateTokens, messageTextContent } from '../utils/messages.js'
import type { SessionMessage } from '../storage/sessions.js'

const COMPACT_SYSTEM = `You compress prior chat turns into a short, faithful summary. Output format:
- One paragraph (<=120 words) covering facts, decisions, goals, and pending threads.
- No preamble, no meta-commentary, no apology.`

export function contextWindow(model: string): number {
  const lower = model.toLowerCase()
  if (lower.includes('qwen') && lower.includes('coder')) return 32_768
  if (lower.includes('llama3')) return 8_192
  if (lower.includes('claude')) return 200_000
  if (lower.includes('gemini')) return 1_000_000
  if (lower.includes('gpt-4o')) return 128_000
  return 8_192
}

export function shouldAutoCompact(messages: Message[], model: string, ratio = 0.8): boolean {
  const budget = contextWindow(model) * ratio
  return approximateTokens(messages) > budget
}

const KEEP_TAIL_TURNS = 2

export async function compactTranscript(
  provider: Provider,
  transcript: Message[],
): Promise<{ ok: true; compacted: Message[] } | { ok: false; reason: string }> {
  const nonSystem = transcript.filter(m => m.role !== 'system')
  if (nonSystem.length <= KEEP_TAIL_TURNS * 2) {
    return { ok: false, reason: 'not enough turns to compact' }
  }

  const headCount = nonSystem.length - KEEP_TAIL_TURNS * 2
  const head = nonSystem.slice(0, headCount)
  const tail = nonSystem.slice(headCount)
  const serialized = head.map(m => `${m.role}: ${messageTextContent(m)}`).join('\n\n')

  const prompt: Message[] = [
    { role: 'system', content: COMPACT_SYSTEM },
    { role: 'user', content: `Summarize this chat history:\n\n${serialized}` },
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

  const system = transcript.find(m => m.role === 'system')
  const out: Message[] = []
  if (system) out.push(system)
  out.push({ role: 'user', content: `[summary of earlier conversation]\n${summary}` })
  out.push({ role: 'assistant', content: 'Understood.' })
  for (const m of tail) out.push(m)
  return { ok: true, compacted: out }
}

export function truncateFallback(messages: Message[], keepTurns = 6): Message[] {
  const system = messages.find(m => m.role === 'system')
  const rest = messages.filter(m => m.role !== 'system')
  const kept = rest.slice(-keepTurns * 2)
  return system ? [system, ...kept] : kept
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
  return `${normalized.slice(0, limit - 1)}…`
}
