import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResumedSessionState, resolveModelSelection, restoreConversationState } from '../src/ui/chatSessionState.js'
import type { EthagentConfig } from '../src/storage/config.js'
import type { SessionMessage } from '../src/storage/sessions.js'

const baseConfig: EthagentConfig = {
  version: 1,
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  baseUrl: 'http://localhost:11434/v1',
  firstRunAt: new Date(0).toISOString(),
}

test('resolveModelSelection returns noop for unchanged ollama model', () => {
  const result = resolveModelSelection(
    { kind: 'ollama', model: 'qwen2.5-coder:7b' },
    baseConfig,
    {
      defaultBaseUrlFor: () => 'http://localhost:11434/v1',
      defaultModelFor: () => 'unused',
    },
  )

  assert.deepEqual(result, { kind: 'noop' })
})

test('resolveModelSelection switches non-ollama providers with provider defaults', () => {
  const result = resolveModelSelection(
    { kind: 'cloud', provider: 'anthropic', keyJustSet: true },
    baseConfig,
    {
      defaultBaseUrlFor: provider => provider === 'ollama' ? 'http://localhost:11434/v1' : undefined,
      defaultModelFor: provider => provider === 'anthropic' ? 'claude-sonnet-4-5' : 'fallback-model',
    },
  )

  assert.equal(result.kind, 'switch')
  if (result.kind !== 'switch') return
  assert.equal(result.config.provider, 'anthropic')
  assert.equal(result.config.model, 'claude-sonnet-4-5')
  assert.match(result.notice, /anthropic key saved/i)
})

test('buildResumedSessionState restores cwd, mode, config, and transcript rows', () => {
  let rowId = 0
  const nextRowId = () => `row-${++rowId}`
  const messages: SessionMessage[] = [
    { role: 'user', content: 'make a file', createdAt: '2026-01-01T00:00:00.000Z', turnId: 'turn-1' },
    { role: 'assistant', content: 'done', createdAt: '2026-01-01T00:00:01.000Z', turnId: 'turn-1' },
  ]

  const resumed = buildResumedSessionState({
    messages,
    metadata: {
      id: 'session-12345678',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
      projectRoot: 'C:/repo',
      workspaceRoot: 'C:/repo',
      lastCwd: 'C:/repo/app',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      mode: 'accept-edits',
      firstUserMessage: 'make a file',
      turnCount: 1,
    },
    fallbackCwd: 'C:/fallback',
    currentConfig: baseConfig,
    nextRowId,
  })

  assert.equal(resumed.cwd, 'C:/repo/app')
  assert.equal(resumed.mode, 'accept-edits')
  assert.equal(resumed.config?.provider, 'anthropic')
  assert.equal(resumed.config?.model, 'claude-sonnet-4-5')
  assert.equal(resumed.rows.at(-1)?.role, 'note')
})

test('restoreConversationState truncates to the first matching turn boundary', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'first', createdAt: '2026-01-01T00:00:00.000Z', turnId: 'turn-a' },
    { role: 'assistant', content: 'first done', createdAt: '2026-01-01T00:00:01.000Z', turnId: 'turn-a' },
    { role: 'user', content: 'second', createdAt: '2026-01-01T00:00:02.000Z', turnId: 'turn-b' },
    { role: 'assistant', content: 'second done', createdAt: '2026-01-01T00:00:03.000Z', turnId: 'turn-b' },
  ]

  let rowId = 0
  const restored = restoreConversationState(messages, 'turn-b', () => `row-${++rowId}`)

  assert.equal(restored.truncated, true)
  assert.equal(restored.messages.length, 2)
  assert.equal(restored.messages[0]?.turnId, 'turn-a')
  assert.equal(restored.rows.length, 2)
})
