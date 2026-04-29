import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResumeOptions, CLEAR_ALL_SESSIONS_VALUE } from '../src/ui/ResumeView.js'
import type { SessionSummary } from '../src/storage/sessions.js'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-1',
    startedAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:01:00.000Z',
    projectRoot: 'C:/repo',
    workspaceRoot: 'C:/repo',
    lastCwd: 'C:/repo',
    provider: 'ollama',
    model: 'qwen',
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
