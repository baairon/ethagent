import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResumeOptions, CLEAR_ALL_SESSIONS_VALUE } from '../src/chat/ResumeView.js'
import type { SessionSummary } from '../src/storage/sessions.js'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-1',
    startedAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:01:00.000Z',
    projectRoot: 'C:/repo',
    workspaceRoot: 'C:/repo',
    lastCwd: 'C:/repo',
    provider: 'llamacpp',
    model: 'org/model#model.gguf',
    firstUserMessage: 'hello',
    turnCount: 1,
    path: 'C:/home/.ethagent/sessions/session-1.jsonl',
    mtimeMs: Date.now(),
    projectLabel: 'repo',
    directoryLabel: '.',
    ...overrides,
  }
}

test('resume options expose a clear all chat logs action', () => {
  const options = buildResumeOptions([session()], 'session-1')
  const clear = options.find(option => option.value === CLEAR_ALL_SESSIONS_VALUE)

  assert.ok(clear)
  assert.equal(clear.label, 'clear all chat logs')
  assert.equal(clear.role, 'utility')
  assert.match(clear.hint ?? '', /saved chats/)
  assert.ok(options.some(option => option.value === 'session-1'))
})

test('resume options show short session id without an explicit id label', () => {
  const options = buildResumeOptions([
    session({
      id: 'abcdef1234567890',
      turnCount: 64,
      compactedFromSessionId: 'source1234567890',
    }),
  ], 'different-session')

  const option = options.find(candidate => candidate.value === 'abcdef1234567890')
  assert.ok(option)
  assert.match(option.hint ?? '', /64 turns/)
  assert.match(option.hint ?? '', /abcdef12/)
  assert.match(option.hint ?? '', /summary from source12/)
  assert.doesNotMatch(option.hint ?? '', /\bid\b/i)
  assert.match(option.hint ?? '', / · /)
  assert.doesNotMatch(option.hint ?? '', / - /)
})
