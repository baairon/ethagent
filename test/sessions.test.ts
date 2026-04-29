import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendSessionMessage,
  clearAllSessions,
  latestUserMessageCorrectsToolState,
  listSessions,
  sessionMessagesToProviderMessages,
  type SessionMessage,
} from '../src/storage/sessions.js'

async function withTempHome(fn: (home: string) => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-sessions-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn(home)
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
  }
}

test('sessionMessagesToProviderMessages omits orphaned historical tool uses', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'create index.html', createdAt: '2026-04-21T00:00:00.000Z' },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'orphan',
      name: 'run_bash',
      input: { command: 'list_directory' },
      createdAt: '2026-04-21T00:00:01.000Z',
    },
    { role: 'user', content: 'retry with a valid tool call', createdAt: '2026-04-21T00:00:02.000Z' },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'paired',
      name: 'list_directory',
      input: {},
      createdAt: '2026-04-21T00:00:03.000Z',
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'paired',
      name: 'list_directory',
      content: 'essay.txt',
      createdAt: '2026-04-21T00:00:04.000Z',
    },
  ]

  const providerMessages = sessionMessagesToProviderMessages(messages)
  const text = JSON.stringify(providerMessages)

  assert.doesNotMatch(text, /orphan/)
  assert.match(text, /paired/)
  assert.match(text, /essay\.txt/)
})

test('sessionMessagesToProviderMessages compacts old tool history while preserving active turn tools', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'create index.html', createdAt: '2026-04-21T00:00:00.000Z', turnId: 'turn-1' },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'tool-create',
      name: 'write_file',
      input: { path: 'index.html', content: '<h1>ok</h1>' },
      createdAt: '2026-04-21T00:00:01.000Z',
      turnId: 'turn-1',
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'tool-create',
      name: 'write_file',
      content: 'updated index.html',
      createdAt: '2026-04-21T00:00:02.000Z',
      turnId: 'turn-1',
    },
    {
      role: 'assistant',
      content: 'verified index.html',
      createdAt: '2026-04-21T00:00:03.000Z',
      turnId: 'turn-1',
    },
    { role: 'user', content: 'read index.html', createdAt: '2026-04-21T00:00:04.000Z', turnId: 'turn-2' },
  ]

  const compacted = JSON.stringify(sessionMessagesToProviderMessages(messages, {
    compactToolHistory: true,
    preserveTurnId: 'turn-2',
  }))
  assert.doesNotMatch(compacted, /tool-create/)
  assert.doesNotMatch(compacted, /tool_result/)
  assert.match(compacted, /verified index\.html/)
  assert.match(compacted, /read index\.html/)

  const activeTurn = JSON.stringify(sessionMessagesToProviderMessages(messages, {
    compactToolHistory: true,
    preserveTurnId: 'turn-1',
  }))
  assert.match(activeTurn, /tool-create/)
  assert.match(activeTurn, /updated index\.html/)
})

test('active-turn tool protocol survives compaction across multiple iterations', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'hi', createdAt: '2026-04-21T00:00:00.000Z', turnId: 'turn-old' },
    { role: 'assistant', content: 'hello', createdAt: '2026-04-21T00:00:01.000Z', turnId: 'turn-old' },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'old-use',
      name: 'list_directory',
      input: {},
      createdAt: '2026-04-21T00:00:02.000Z',
      turnId: 'turn-old',
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'old-use',
      name: 'list_directory',
      content: 'old entries',
      createdAt: '2026-04-21T00:00:03.000Z',
      turnId: 'turn-old',
    },

    { role: 'user', content: 'edit index.html', createdAt: '2026-04-21T00:01:00.000Z', turnId: 'turn-active' },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'active-read',
      name: 'read_file',
      input: { path: 'index.html' },
      createdAt: '2026-04-21T00:01:01.000Z',
      turnId: 'turn-active',
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'active-read',
      name: 'read_file',
      content: '<h1>ok</h1>',
      createdAt: '2026-04-21T00:01:02.000Z',
      turnId: 'turn-active',
    },
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'active-edit',
      name: 'edit_file',
      input: { path: 'index.html', oldText: '<h1>ok</h1>', newText: '<h1>welcome</h1>' },
      createdAt: '2026-04-21T00:01:03.000Z',
      turnId: 'turn-active',
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'active-edit',
      name: 'edit_file',
      content: 'edited index.html',
      createdAt: '2026-04-21T00:01:04.000Z',
      turnId: 'turn-active',
    },
  ]

  const projected = JSON.stringify(sessionMessagesToProviderMessages(messages, {
    compactToolHistory: true,
    preserveTurnId: 'turn-active',
  }))

  assert.doesNotMatch(projected, /old-use/, 'prior-turn tool_use should be compacted away')
  assert.doesNotMatch(projected, /old entries/, 'prior-turn tool_result content should be compacted away')
  assert.match(projected, /active-read/, 'active-turn read_file tool_use must be preserved')
  assert.match(projected, /<h1>ok<\/h1>/, 'active-turn read_file tool_result content must be preserved')
  assert.match(projected, /active-edit/, 'active-turn edit_file tool_use must be preserved')
  assert.match(projected, /edited index\.html/, 'active-turn edit_file tool_result content must be preserved')
})

test('sessionMessagesToProviderMessages drops unsupported assistant claims after user correction', () => {
  const messages: SessionMessage[] = [
    { role: 'user', content: 'cd into identity', createdAt: '2026-04-21T00:00:00.000Z' },
    {
      role: 'assistant',
      content: 'It appears that the directory identity does not exist in your current working directory.',
      createdAt: '2026-04-21T00:00:01.000Z',
    },
    { role: 'user', content: 'it does exist, just try', createdAt: '2026-04-21T00:00:02.000Z' },
  ]

  const projected = JSON.stringify(sessionMessagesToProviderMessages(messages))

  assert.equal(latestUserMessageCorrectsToolState(messages), true)
  assert.doesNotMatch(projected, /does not exist/)
  assert.match(projected, /just try/)
})

test('latestUserMessageCorrectsToolState accepts terse user corrections', () => {
  assert.equal(latestUserMessageCorrectsToolState([
    { role: 'user', content: 'cd into identity', createdAt: '2026-04-21T00:00:00.000Z' },
    { role: 'assistant', content: 'I am now in the identity directory.', createdAt: '2026-04-21T00:00:01.000Z' },
    { role: 'user', content: 'u didnt execute the tool call', createdAt: '2026-04-21T00:00:02.000Z' },
  ]), true)
  assert.equal(latestUserMessageCorrectsToolState([
    { role: 'user', content: 'cd into identity', createdAt: '2026-04-21T00:00:00.000Z' },
    { role: 'assistant', content: 'I am now in the identity directory.', createdAt: '2026-04-21T00:00:01.000Z' },
    { role: 'user', content: 'u didnt cage it', createdAt: '2026-04-21T00:00:02.000Z' },
  ]), true)
})

test('clearAllSessions removes saved chat logs and session metadata', async () => {
  await withTempHome(async home => {
    const createdAt = '2026-04-28T00:00:00.000Z'
    await appendSessionMessage('session-a', { role: 'user', content: 'hello', createdAt }, {
      cwd: home,
      provider: 'ollama',
      model: 'qwen',
    })
    await appendSessionMessage('session-b', { role: 'user', content: 'again', createdAt }, {
      cwd: home,
      provider: 'ollama',
      model: 'qwen',
    })

    assert.equal((await listSessions()).length, 2)

    const result = await clearAllSessions()
    assert.equal(result.sessionFiles, 2)
    assert.equal(result.metadataFiles, 2)
    assert.deepEqual(await listSessions(), [])

    assert.deepEqual(await clearAllSessions(), { sessionFiles: 0, metadataFiles: 0 })
  })
})
