import test from 'node:test'
import assert from 'node:assert/strict'
import {
  microCompactSessionMessages,
  shouldMicroCompact,
} from '../src/runtime/compaction.js'
import type { SessionMessage } from '../src/storage/sessions.js'

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
