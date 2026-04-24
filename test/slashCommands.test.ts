import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchSlash, type SlashContext } from '../src/commands/index.js'
import type { EthagentConfig } from '../src/storage/config.js'

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
    onCopyPickerRequest: () => {},
    onPullStart: () => ({ progressId: 'progress-test', signal: new AbortController().signal }),
    onPullProgress: () => {},
    onPullDone: () => {},
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
