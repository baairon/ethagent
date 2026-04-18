import type { Message, Provider } from '../providers/contracts.js'
import { approximateTokens } from './messages.js'

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
  const serialized = head.map(m => `${m.role}: ${m.content}`).join('\n\n')

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
