import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCompactionSource,
  compactTranscript,
  contextUsageFromTokens,
  microCompactSessionMessages,
  shouldConfirmContextUsage,
  shouldMicroCompact,
  summarizeTranscriptLocally,
} from '../src/runtime/compaction.js'
import type { SessionMessage } from '../src/storage/sessions.js'
import type { Message, Provider, StreamEvent } from '../src/providers/contracts.js'

function userTurn(turnId: string, content: string, timeOffsetSeconds = 0): SessionMessage[] {
  const baseTs = new Date(Date.parse('2026-04-21T00:00:00.000Z') + timeOffsetSeconds * 1000).toISOString()
  const assistantTs = new Date(Date.parse('2026-04-21T00:00:00.000Z') + (timeOffsetSeconds + 1) * 1000).toISOString()
  return [
    { role: 'user', content, createdAt: baseTs, turnId },
    { role: 'assistant', content: `reply to ${content}`, createdAt: assistantTs, turnId },
  ]
}

function buildTurns(count: number): SessionMessage[] {
  const messages: SessionMessage[] = []
  for (let i = 0; i < count; i += 1) {
    messages.push(...userTurn(`turn-${i}`, `request ${i}`, i * 10))
  }
  return messages
}

test('shouldMicroCompact returns false below the trigger', () => {
  const messages = buildTurns(10)
  assert.equal(shouldMicroCompact(messages), false)
})

test('shouldMicroCompact returns true above the trigger', () => {
  const messages = buildTurns(30)
  assert.equal(shouldMicroCompact(messages), true)
})

test('microCompactSessionMessages is a no-op below the trigger', () => {
  const messages = buildTurns(10)
  const result = microCompactSessionMessages(messages)
  assert.equal(result.compactedTurns, 0)
  assert.equal(result.messages, messages)
})

test('microCompactSessionMessages keeps the most recent recent-budget turns verbatim', () => {
  const messages = buildTurns(30)
  const result = microCompactSessionMessages(messages)
  assert.ok(result.compactedTurns > 0, 'expected compaction to happen')

  const keptTurnIds = new Set<string>()
  for (const message of result.messages) {
    const turnId = (message as { turnId?: string }).turnId
    if (turnId) keptTurnIds.add(turnId)
  }

  for (let i = 30 - 15; i < 30; i += 1) {
    assert.ok(keptTurnIds.has(`turn-${i}`), `expected turn-${i} to be preserved verbatim`)
  }
  assert.equal(keptTurnIds.has('turn-0'), false)
  assert.equal(keptTurnIds.has('turn-5'), false)
})

test('microCompactSessionMessages preserves active turn even if it would fall outside the recent budget', () => {
  const messages = buildTurns(30)
  const result = microCompactSessionMessages(messages, { activeTurnId: 'turn-1' })
  assert.ok(result.compactedTurns > 0)
  const keptTurnIds = new Set<string>()
  for (const message of result.messages) {
    const turnId = (message as { turnId?: string }).turnId
    if (turnId) keptTurnIds.add(turnId)
  }
  assert.ok(keptTurnIds.has('turn-1'), 'active turn must be preserved even when outside recent budget')
})

test('microCompactSessionMessages produces a summary referencing recent user requests', () => {
  const messages = buildTurns(30)
  const result = microCompactSessionMessages(messages)
  const summary = result.messages.find(m => {
    if (m.role !== 'assistant') return false
    const content = (m as { content?: unknown }).content
    return typeof content === 'string' && content.includes('Earlier conversation context was compacted')
  })
  assert.ok(summary, 'summary message should be present')
  const body = (summary as { content?: unknown }).content
  assert.ok(typeof body === 'string')
  assert.match(body, /Most recent earlier user requests/)
})

test('context usage is calculated against the active model window', () => {
  const llama = contextUsageFromTokens(32_000, 'llamacpp', 'llama3.1')
  const qwen = contextUsageFromTokens(32_000, 'llamacpp', 'qwen3:8b')
  const openai = contextUsageFromTokens(32_000, 'openai', 'gpt-4o')
  const gpt41 = contextUsageFromTokens(32_000, 'openai', 'gpt-4.1')

  assert.equal(llama.windowTokens, 128_000)
  assert.equal(llama.percent, 25)
  assert.equal(qwen.windowTokens, 40_000)
  assert.equal(qwen.percent, 80)
  assert.equal(openai.windowTokens, 128_000)
  assert.equal(openai.percent, 25)
  assert.equal(gpt41.windowTokens, 1_000_000)
  assert.equal(gpt41.percent, 3)
})

test('context confirmation uses percent without compacting automatically', () => {
  assert.equal(shouldConfirmContextUsage(contextUsageFromTokens(28_000, 'llamacpp', 'qwen3:8b'), 90), false)
  assert.equal(shouldConfirmContextUsage(contextUsageFromTokens(37_000, 'llamacpp', 'qwen3:8b'), 90), true)
})

test('local transcript summary preserves recent user and assistant context when provider compacting fails', () => {
  const messages: Message[] = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'Implement encrypted continuity snapshots.' },
    { role: 'assistant', content: 'Added the envelope and tests.' },
    { role: 'user', content: 'Fix /compact so it creates a new summarized conversation.' },
  ]

  const summary = summarizeTranscriptLocally(messages, 'summary too short')

  assert.match(summary, /Provider summary was unavailable: summary too short/)
  assert.match(summary, /Implement encrypted continuity snapshots/)
  assert.match(summary, /Added the envelope and tests/)
  assert.match(summary, /Fix \/compact/)
  assert.doesNotMatch(summary, /system prompt/)
})

test('local compaction source bounds oversized transcripts before provider summarization', () => {
  const messages: Message[] = [
    { role: 'system', content: 'system prompt' },
    ...Array.from({ length: 80 }, (_, index): Message => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index} ${'x'.repeat(1200)}`,
    })),
  ]

  const source = buildCompactionSource(messages, 'llamacpp')

  assert.equal(source.compressed, true)
  assert.ok(source.inputTokens <= 6_000)
  assert.match(source.text, /Deterministic pre-summary/)
  assert.match(source.text, /Recent transcript excerpts/)
  assert.doesNotMatch(source.text, /system prompt/)
})

test('compactTranscript can be cancelled by the caller signal', async () => {
  const controller = new AbortController()
  const provider: Provider = {
    id: 'llamacpp',
    model: 'test',
    supportsTools: false,
    async *complete(_messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent> {
      controller.abort()
      if (signal.aborted) return
      yield { type: 'text', delta: 'this should not finish' }
    },
  }

  const result = await compactTranscript(provider, [
    { role: 'user', content: 'please summarize' },
    { role: 'assistant', content: 'working' },
  ], { signal: controller.signal })

  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
})
