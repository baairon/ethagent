import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchSlash, type SlashContext } from '../src/chat/commands.js'
import type { EthagentConfig } from '../src/storage/config.js'
import { contextUsageFromTokens } from '../src/runtime/compaction.js'

const config: EthagentConfig = {
  version: 1,
  provider: 'openai',
  model: 'gpt-4o-mini',
  firstRunAt: new Date(0).toISOString(),
}

function context(overrides: Partial<SlashContext> = {}): SlashContext {
  return {
    config,
    turns: 0,
    approxTokens: 0,
    contextUsage: contextUsageFromTokens(0, config.provider, config.model),
    startedAt: 0,
    sessionId: 'session-test',
    cwd: process.cwd(),
    mode: 'chat',
    sessionMessages: () => [],
    assistantTurns: () => [],
    onReplaceConfig: () => {},
    onChangeCwd: () => {},
    onClear: () => {},
    onExit: () => {},
    onResumeRequest: () => {},
    onModelPickerRequest: () => {},
    onRewindRequest: () => {},
    onPermissionsRequest: () => {},
    onCompactRequest: () => {},
    onIdentityRequest: () => {},
    onCopyPickerRequest: () => {},
    ...overrides,
  }
}

test('/model with no args requests the model picker overlay', async () => {
  let requested = false
  const result = await dispatchSlash('/model', context({
    onModelPickerRequest: () => { requested = true },
  }))

  assert.deepEqual(result, { kind: 'handled' })
  assert.equal(requested, true)
})

test('/hf download opens the model picker without exposing a remote catalog', async () => {
  let requested = false
  const result = await dispatchSlash('/hf download https://huggingface.co/org/model-GGUF', context({
    onModelPickerRequest: () => { requested = true },
  }))

  assert.equal(result?.kind, 'note')
  if (result?.kind !== 'note') return
  assert.equal(requested, true)
  assert.match(result.text, /add local model file/)
  assert.doesNotMatch(result.text, /catalog/i)
})

test('/pull is no longer exposed after removing Ollama support', async () => {
  const result = await dispatchSlash('/pull qwen2.5-coder:7b', context())

  assert.equal(result?.kind, 'note')
  if (result?.kind !== 'note') return
  assert.equal(result.variant, 'error')
  assert.match(result.text, /unknown command: \/pull/)
})

test('/help lists the identity shortcut in the shortcuts footer', async () => {
  const result = await dispatchSlash('/help', context())

  assert.equal(result?.kind, 'note')
  if (result?.kind !== 'note') return
  assert.match(result.text, /alt\+i identity/)
  assert.match(result.text, /alt\+p model/)
})

test('/identity load opens the identity hub with the requested action', async () => {
  const requests: unknown[] = []

  assert.deepEqual(await dispatchSlash('/identity load', context({
    onIdentityRequest: action => { requests.push(action) },
  })), { kind: 'handled' })

  assert.equal(requests[0], 'load')
})

test('/identity export and import are removed from the ERC-8004 flow', async () => {
  assert.deepEqual(await dispatchSlash('/identity export', context()), {
    kind: 'note',
    variant: 'error',
    text: 'usage: /identity [status|create|load|remove confirm]',
  })
  assert.deepEqual(await dispatchSlash('/identity import', context()), {
    kind: 'note',
    variant: 'error',
    text: 'usage: /identity [status|create|load|remove confirm]',
  })
})
