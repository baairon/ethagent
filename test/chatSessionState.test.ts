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

test('resolveModelSelection switches non-ollama providers with the selected model', () => {
  const result = resolveModelSelection(
    { kind: 'cloud', provider: 'anthropic', model: 'claude-opus-4-1', keyJustSet: true },
    baseConfig,
    {
      defaultBaseUrlFor: provider => provider === 'ollama' ? 'http://localhost:11434/v1' : undefined,
      defaultModelFor: provider => provider === 'anthropic' ? 'claude-sonnet-4-5' : 'fallback-model',
    },
  )

  assert.equal(result.kind, 'switch')
  if (result.kind !== 'switch') return
  assert.equal(result.config.provider, 'anthropic')
  assert.equal(result.config.model, 'claude-opus-4-1')
  assert.match(result.notice, /anthropic key saved/i)
})

test('resolveModelSelection switches to a local Hugging Face model with the default local base URL', () => {
  const result = resolveModelSelection(
    { kind: 'llamacpp', model: 'org/model#model.Q4_K_M.gguf' },
    baseConfig,
    {
      defaultBaseUrlFor: provider => provider === 'llamacpp' ? 'http://localhost:8080/v1' : undefined,
      defaultModelFor: () => 'unused',
    },
  )

  assert.equal(result.kind, 'switch')
  if (result.kind !== 'switch') return
  assert.equal(result.config.provider, 'llamacpp')
  assert.equal(result.config.model, 'org/model#model.Q4_K_M.gguf')
  assert.equal(result.config.baseUrl, 'http://localhost:8080/v1')
  assert.match(result.notice, /local Hugging Face model ready/i)
})

test('resolveModelSelection preserves an explicit cloud model when provider is unchanged', () => {
  const current: EthagentConfig = {
    ...baseConfig,
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://compat.example/v1',
  }
  const result = resolveModelSelection(
    { kind: 'cloud', provider: 'openai', model: 'custom-model', keyJustSet: false },
    current,
    {
      defaultBaseUrlFor: provider => provider === 'ollama' ? 'http://localhost:11434/v1' : undefined,
      defaultModelFor: () => 'unused-default',
    },
  )

  assert.equal(result.kind, 'switch')
  if (result.kind !== 'switch') return
  assert.equal(result.config.provider, 'openai')
  assert.equal(result.config.model, 'custom-model')
  assert.equal(result.config.baseUrl, 'https://compat.example/v1')
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

test('buildResumedSessionState keeps every resumed transcript row visible to the renderer', () => {
  let rowId = 0
  const messages: SessionMessage[] = Array.from({ length: 450 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message ${index}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    turnId: `turn-${Math.floor(index / 2)}`,
  }))

  const resumed = buildResumedSessionState({
    messages,
    metadata: null,
    fallbackCwd: 'C:/fallback',
    currentConfig: baseConfig,
    nextRowId: () => `row-${++rowId}`,
  })

  assert.equal(resumed.rows.length, messages.length + 1)
  assert.equal(resumed.rows[0]?.role, 'user')
  assert.equal(resumed.rows[0]?.id, 'row-1')
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
