import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Provider, StreamEvent } from '../src/providers/contracts.js'
import type { SessionMessage } from '../src/storage/sessions.js'
import type { MessageRow } from '../src/ui/MessageList.js'
import { runStreamingTurn } from '../src/ui/chatTurnOrchestrator.js'

function makeContext(overrides: {
  cwd: string
  provider: Provider
  userText: string
  sessionMessages: SessionMessage[]
  rows: MessageRow[]
  mode?: 'chat' | 'accept-edits' | 'plan'
  executeTool?: (name: string, input: Record<string, unknown>) => Promise<{ result: { ok: boolean; summary: string; content: string } }>
}) {
  return {
    provider: overrides.provider,
    mode: overrides.mode ?? 'accept-edits',
    sessionId: 'session-test',
    userText: overrides.userText,
    streamFlushMs: 1,
    controller: new AbortController(),
    nextRowId: (() => {
      let id = 0
      return () => `row-${++id}`
    })(),
    nowIso: () => '2026-04-21T00:00:00.000Z',
    getConfig: () => ({
      version: 1 as const,
      provider: 'ollama' as const,
      model: 'qwen-test',
      firstRunAt: '2026-04-21T00:00:00.000Z',
    }),
    getCwd: () => overrides.cwd,
    getDisplayCwd: () => overrides.cwd,
    getSessionMessages: () => overrides.sessionMessages,
    setActiveCheckpoint: () => {},
    setStreaming: () => {},
    updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => {
      overrides.rows.splice(0, overrides.rows.length, ...updater(overrides.rows))
    },
    pushNote: () => {},
    persistTurnMessage: async (message: SessionMessage) => {
      overrides.sessionMessages.push(message)
    },
    executeTool: overrides.executeTool
      ? async (name: string, input: Record<string, unknown>) => {
          const res = await overrides.executeTool!(name, input)
          return res as { result: { ok: boolean; summary: string; content: string }; sessionRule?: undefined; persistRule?: undefined }
        }
      : async (name: string) => {
          throw new Error(`unexpected tool call: ${name}`)
        },
    applySessionRule: async () => {},
    pendingAssistantTextRef: { current: null },
    pendingThinkingTextRef: { current: null },
    streamFlushTimerRef: { current: null },
  }
}

test('runStreamingTurn completes a single tool call and loops back for model summary', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      if (providerCalls === 1) {
        yield {
          type: 'tool_use_stop',
          id: 'tool-1',
          name: 'edit_file',
          input: { path: 'hello.txt', newText: 'hello\n' },
        }
        yield { type: 'done', stopReason: 'tool_use' }
      } else {
        yield { type: 'text', delta: 'Created hello.txt.' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'write a file named hello.txt',
    sessionMessages,
    rows,
    executeTool: async (name, input) => {
      assert.equal(name, 'edit_file')
      const target = path.join(cwd, String(input.path))
      await fs.writeFile(target, String(input.newText), 'utf8')
      return { result: { ok: true, summary: `create ${input.path}`, content: `updated ${target}` } }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 2)
  assert.equal(await fs.readFile(path.join(cwd, 'hello.txt'), 'utf8'), 'hello\n')
  assert.ok(rows.some(row => row.role === 'assistant' && /Created hello\.txt/i.test(row.content)))
})

test('runStreamingTurn stops when model emits no tool_uses (model decides it is done)', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      yield {
        type: 'text',
        delta: 'The file already says Welcome. No changes needed.',
      }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'change hello to welcome',
    sessionMessages,
    rows,
    mode: 'chat',
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 1)
  assert.ok(rows.some(row => row.role === 'assistant' && /No changes needed/i.test(row.content)))
  // No tool_requirement failure row — the model's decision is trusted
  assert.ok(rows.every(row => row.role !== 'tool_result' || row.name !== 'tool_requirement'))
})

test('runStreamingTurn feeds tool errors back to model as tool_results', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      if (providerCalls === 1) {
        yield {
          type: 'tool_use_stop',
          id: 'tool-bad',
          name: 'edit_file',
          input: { path: 'index.html', oldText: '<h1>Hello</h1>', newText: '<h1>Welcome</h1>' },
        }
        yield { type: 'done', stopReason: 'tool_use' }
      } else {
        // Model sees the error, reads file, and stops since it's already correct
        yield { type: 'text', delta: 'The file already contains Welcome.' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'change hello to welcome',
    sessionMessages,
    rows,
    executeTool: async (name) => {
      assert.equal(name, 'edit_file')
      return {
        result: {
          ok: false,
          summary: 'edit_file failed',
          content: 'oldText was not found in the file',
        },
      }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 2)
  // The error tool_result is shown
  assert.ok(rows.some(row => row.role === 'tool_result' && row.name === 'edit_file' && row.isError))
  // Model's final text is persisted
  assert.ok(rows.some(row => row.role === 'assistant' && /already contains Welcome/i.test(row.content)))
})

test('runStreamingTurn handles multi-tool round and loops correctly', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      if (providerCalls === 1) {
        yield { type: 'tool_use_stop', id: 'tool-list', name: 'list_directory', input: {} }
        yield { type: 'done', stopReason: 'tool_use' }
      } else if (providerCalls === 2) {
        yield {
          type: 'tool_use_stop',
          id: 'tool-write',
          name: 'write_file',
          input: { path: 'index.html', content: '<!doctype html>\n<title>ok</title>\n' },
        }
        yield { type: 'done', stopReason: 'tool_use' }
      } else {
        yield { type: 'text', delta: 'Created index.html.' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'create index.html',
    sessionMessages,
    rows,
    executeTool: async (name, input) => {
      if (name === 'list_directory') {
        return { result: { ok: true, summary: 'listed .', content: '(empty directory)' } }
      }
      if (name === 'write_file') {
        const target = path.join(cwd, String(input.path))
        await fs.writeFile(target, String(input.content), 'utf8')
        return { result: { ok: true, summary: `create ${input.path}`, content: `updated ${target}` } }
      }
      throw new Error(`unexpected tool: ${name}`)
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 3)
  assert.equal(await fs.readFile(path.join(cwd, 'index.html'), 'utf8'), '<!doctype html>\n<title>ok</title>\n')
})

test('runStreamingTurn allows advisory text-only response without enforcement failure', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      yield {
        type: 'text',
        delta: 'A local HTML page is a good next step.',
      }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'what else should we build?',
    sessionMessages,
    rows,
    mode: 'chat',
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 1)
  assert.ok(rows.some(row => row.role === 'assistant' && /local HTML page/i.test(row.content)))
  assert.ok(rows.every(row => row.role !== 'tool_result' || row.name !== 'tool_requirement'))
})

test('runStreamingTurn persists assistant text before stopping', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      yield { type: 'text', delta: 'Done.' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'hello',
    sessionMessages,
    rows,
    mode: 'chat',
  }))

  assert.ok(sessionMessages.some(m => m.role === 'assistant' && m.content === 'Done.'))
})

