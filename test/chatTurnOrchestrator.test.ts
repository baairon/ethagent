import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Provider, StreamEvent } from '../src/providers/contracts.js'
import type { SessionMessage } from '../src/storage/sessions.js'
import { toggleLatestReasoningRow, type MessageRow } from '../src/ui/MessageList.js'
import { runStreamingTurn } from '../src/ui/chatTurnOrchestrator.js'

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function makeContext(overrides: {
  cwd: string
  provider: Provider
  userText: string
  sessionMessages: SessionMessage[]
  rows: MessageRow[]
  mode?: 'chat' | 'accept-edits' | 'plan'
  notes?: Array<{ text: string; kind: 'info' | 'error' | 'dim' }>
  preflightProvider?: () => Promise<{ ok: true } | { ok: false; message: string }>
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
    pushNote: (text: string, kind: 'info' | 'error' | 'dim' = 'info') => {
      overrides.notes?.push({ text, kind })
    },
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
    preflightProvider: overrides.preflightProvider,
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

test('runStreamingTurn executes Ollama JSON tool text without persisting fake assistant text', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0
  let toolCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      if (providerCalls === 1) {
        yield { type: 'text', delta: '{\n  "name": "list_directory",\n  "arguments": {}\n}' }
        yield { type: 'done', stopReason: 'end_turn' }
      } else {
        yield { type: 'text', delta: 'I see package.json and src.' }
        yield { type: 'done', stopReason: 'end_turn' }
      }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'list all the files in this directory',
    sessionMessages,
    rows,
    mode: 'chat',
    executeTool: async (name, input) => {
      toolCalls += 1
      assert.equal(name, 'list_directory')
      assert.deepEqual(input, {})
      return { result: { ok: true, summary: 'listed .', content: 'package.json\nsrc' } }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 2)
  assert.equal(toolCalls, 1)
  assert.ok(sessionMessages.some(m => m.role === 'tool_use' && m.name === 'list_directory'))
  assert.ok(sessionMessages.some(m => m.role === 'tool_result' && m.name === 'list_directory'))
  assert.ok(sessionMessages.every(m =>
    m.role !== 'assistant' || !m.content.includes('"name": "list_directory"'),
  ))
  assert.ok(rows.every(row =>
    row.role !== 'assistant' || !row.content.includes('"name": "list_directory"'),
  ))
  assert.ok(rows.some(row => row.role === 'assistant' && /package\.json/i.test(row.content)))
})

test('runStreamingTurn executes direct cd requests without asking the model', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0
  let toolCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      yield { type: 'text', delta: 'should not be called' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'cd into identity',
    sessionMessages,
    rows,
    executeTool: async (name, input) => {
      toolCalls += 1
      assert.equal(name, 'change_directory')
      assert.deepEqual(input, { path: 'identity' })
      return { result: { ok: true, summary: 'changed directory', content: path.join(cwd, 'identity') } }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 0)
  assert.equal(toolCalls, 1)
  assert.ok(sessionMessages.some(m => m.role === 'tool_use' && m.name === 'change_directory'))
  assert.ok(rows.some(row => row.role === 'tool_result' && row.name === 'change_directory'))
})

test('runStreamingTurn proceeds to provider after successful preflight', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0
  let preflightCalls = 0

  const provider: Provider = {
    id: 'llamacpp',
    model: 'org/model#model.gguf',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      yield { type: 'text', delta: 'Ready.' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'hello local model',
    sessionMessages,
    rows,
    mode: 'chat',
    preflightProvider: async () => {
      preflightCalls += 1
      return { ok: true }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(preflightCalls, 1)
  assert.equal(providerCalls, 1)
  assert.ok(rows.some(row => row.role === 'assistant' && row.content === 'Ready.'))
})

test('runStreamingTurn skips provider call when preflight fails', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  const notes: Array<{ text: string; kind: 'info' | 'error' | 'dim' }> = []
  let providerCalls = 0

  const provider: Provider = {
    id: 'llamacpp',
    model: 'org/model#model.gguf',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      yield { type: 'text', delta: 'should not stream' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'hello local model',
    sessionMessages,
    rows,
    notes,
    mode: 'chat',
    preflightProvider: async () => ({
      ok: false,
      message: 'local runner is not reachable; failed to start org/model / model.gguf: runner missing',
    }),
  }))

  assert.equal(result.finishedNormally, false)
  assert.equal(providerCalls, 0)
  assert.ok(notes.some(note =>
    note.kind === 'error' &&
    /local runner is not reachable/.test(note.text),
  ))
  assert.ok(rows.every(row =>
    row.role !== 'assistant' || !row.content.includes('should not stream'),
  ))
})

test('runStreamingTurn suppresses unverified state claims during corrective nudges', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let providerCalls = 0
  let toolCalls = 0

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      providerCalls += 1
      if (providerCalls === 1) {
        yield {
          type: 'text',
          delta: 'It appears that the directory identity does not exist in your current working directory.',
        }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      if (providerCalls === 2) {
        yield {
          type: 'tool_use_stop',
          id: 'tool-1',
          name: 'change_directory',
          input: { path: 'identity' },
        }
        yield { type: 'done', stopReason: 'tool_use' }
        return
      }
      yield { type: 'text', delta: 'Changed into identity.' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const result = await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'yes',
    sessionMessages,
    rows,
    executeTool: async (name, input) => {
      toolCalls += 1
      assert.equal(name, 'change_directory')
      assert.deepEqual(input, { path: 'identity' })
      return { result: { ok: true, summary: 'changed directory', content: path.join(cwd, 'identity') } }
    },
  }))

  assert.equal(result.finishedNormally, true)
  assert.equal(providerCalls, 3)
  assert.equal(toolCalls, 1)
  assert.ok(sessionMessages.every(message =>
    message.role !== 'assistant' || !/does not exist/i.test(message.content),
  ))
  assert.ok(rows.every(row =>
    row.role !== 'assistant' || !/does not exist/i.test(row.content),
  ))
  assert.ok(rows.some(row => row.role === 'assistant' && /Changed into identity/i.test(row.content)))
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

test('runStreamingTurn keeps reasoning collapsed and out of session history', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      yield { type: 'thinking', delta: 'First step. ' }
      await wait(5)
      yield { type: 'thinking', delta: 'Second step.' }
      yield { type: 'text', delta: 'Done.' }
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'think then answer',
    sessionMessages,
    rows,
    mode: 'chat',
  }))

  const reasoning = rows.find((row): row is Extract<MessageRow, { role: 'thinking' }> => row.role === 'thinking')
  assert.ok(reasoning)
  assert.equal(reasoning.expanded, false)
  assert.equal(reasoning.streaming, false)
  assert.equal(reasoning.showCursor, false)
  assert.equal(reasoning.content, 'First step. Second step.')
  assert.ok(rows.some(row => row.role === 'assistant' && row.content === 'Done.'))
  assert.ok(sessionMessages.every(message =>
    message.role !== 'assistant' || !message.content.includes('First step'),
  ))

  const expanded = toggleLatestReasoningRow(rows)
  const expandedReasoning = expanded.find((row): row is Extract<MessageRow, { role: 'thinking' }> => row.role === 'thinking')
  assert.ok(expandedReasoning)
  assert.equal(expandedReasoning.expanded, true)
})

test('runStreamingTurn hides the reasoning cursor as soon as answer text starts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-orch-'))
  const sessionMessages: SessionMessage[] = []
  const rows: MessageRow[] = []
  let checkedAfterText = false

  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      yield { type: 'thinking', delta: 'Thinking.' }
      yield { type: 'text', delta: 'Answer.' }
      const reasoning = rows.find((row): row is Extract<MessageRow, { role: 'thinking' }> => row.role === 'thinking')
      assert.ok(reasoning)
      assert.equal(reasoning.showCursor, false)
      checkedAfterText = true
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  await runStreamingTurn(makeContext({
    cwd,
    provider,
    userText: 'think then answer',
    sessionMessages,
    rows,
    mode: 'chat',
  }))

  assert.equal(checkedAfterText, true)
})
