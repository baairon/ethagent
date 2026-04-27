import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Provider, StreamEvent } from '../src/providers/contracts.js'
import {
  MAX_CONTINUATION_NUDGES,
  looksLikeContinuationIntent,
  parseLocalModelTextToolUse,
  runRuntimeTurn,
  type TurnEvent,
} from '../src/runtime/turn.js'

function textProvider(responses: Array<StreamEvent[]>): {
  provider: Provider
  callsRef: { count: number }
} {
  const callsRef = { count: 0 }
  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(): AsyncIterable<StreamEvent> {
      const events = responses[callsRef.count] ?? []
      callsRef.count += 1
      for (const ev of events) yield ev
    },
  }
  return { provider, callsRef }
}

async function collect(
  gen: AsyncGenerator<TurnEvent, void, void>,
): Promise<TurnEvent[]> {
  const out: TurnEvent[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

test('runRuntimeTurn emits iteration_start then streams text and completes', async () => {
  const { provider, callsRef } = textProvider([
    [
      { type: 'text', delta: 'hello ' },
      { type: 'text', delta: 'world' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'hi' }],
      rebuildMessages: () => [{ role: 'user', content: 'hi' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.equal(callsRef.count, 1)
  assert.equal(events[0]!.type, 'iteration_start')
  assert.ok(events.some(e => e.type === 'text' && e.delta === 'hello '))
  assert.ok(events.some(e => e.type === 'assistant_message_committed'))
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: true })
})

test('runRuntimeTurn loops provider after tool batch and feeds rebuilt messages', async () => {
  const rebuiltCalls: number[] = []
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'read_file',
        input: { path: 'a.txt' },
      },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text', delta: 'done reading' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  let rebuildCount = 0
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'read' }],
      rebuildMessages: () => {
        rebuildCount += 1
        rebuiltCalls.push(rebuildCount)
        return [{ role: 'user', content: 'read' }]
      },
      runToolBatch: async pending => ({
        cancelled: false,
        completedTools: pending.map(t => ({
          ...t,
          cwd: '/tmp',
          result: { ok: true, summary: 'ok', content: 'file contents' },
        })),
      }),
    }),
  )

  assert.equal(callsRef.count, 2)
  assert.ok(events.some(e => e.type === 'tool_use_stop' && e.name === 'read_file'))
  assert.ok(events.some(e => e.type === 'tool_executed' && e.name === 'read_file'))
  // Two iteration_start events — one per provider call.
  assert.equal(events.filter(e => e.type === 'iteration_start').length, 2)
  // rebuildMessages should be called at least once (for the follow-up stream).
  assert.ok(rebuiltCalls.length >= 1)
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: true })
})

test('runRuntimeTurn triggers a continuation nudge when model signals intent without tool_use', async () => {
  const { provider, callsRef } = textProvider([
    [
      { type: 'text', delta: "Now I'll create the file." },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'write_file',
        input: { path: 'a.txt', content: 'x' },
      },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text', delta: 'File created.' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  let lastRebuilt: Message[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'create a.txt' }],
      rebuildMessages: () => {
        const msgs: Message[] = [{ role: 'user', content: 'create a.txt' }]
        lastRebuilt = msgs
        return msgs
      },
      runToolBatch: async pending => ({
        cancelled: false,
        completedTools: pending.map(t => ({
          ...t,
          cwd: '/tmp',
          result: { ok: true, summary: 'ok', content: 'wrote' },
        })),
      }),
    }),
  )

  assert.equal(callsRef.count, 3, 'provider should be called 3x (initial, post-nudge, post-tool)')
  const nudgeEvents = events.filter(e => e.type === 'continuation_nudge')
  assert.equal(nudgeEvents.length, 1)
  assert.equal((nudgeEvents[0] as { attempt: number }).attempt, 1)
  // The lastRebuilt snapshot is mutated across calls; we just confirm the loop
  // invoked rebuildMessages (checked indirectly by provider call count).
  assert.ok(lastRebuilt.length >= 1)
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: true })
})

test('runRuntimeTurn converts bare Ollama JSON tool text into a real tool use', async () => {
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'text',
        delta: '{\n  "name": "list_directory",\n  "arguments": {}\n}',
      },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      { type: 'text', delta: 'Directory listed.' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  const executedTools: string[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'list files' }],
      rebuildMessages: () => [{ role: 'user', content: 'list files' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: 'listed .', content: 'a.txt' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 2)
  assert.deepEqual(executedTools, ['list_directory'])
  assert.ok(events.some(e => e.type === 'tool_use_stop' && e.name === 'list_directory'))
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('"name": "list_directory"'),
  ))
})

test('runRuntimeTurn caps continuation nudges at MAX_CONTINUATION_NUDGES', async () => {
  // Every response is a continuation-shaped text with no tool_use. The loop
  // should nudge MAX_CONTINUATION_NUDGES times, then give up and emit done.
  const responses: Array<StreamEvent[]> = []
  for (let i = 0; i < MAX_CONTINUATION_NUDGES + 2; i += 1) {
    responses.push([
      { type: 'text', delta: "Now I'll edit the file." },
      { type: 'done', stopReason: 'end_turn' },
    ])
  }
  const { provider, callsRef } = textProvider(responses)

  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'do something' }],
      rebuildMessages: () => [{ role: 'user', content: 'do something' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.equal(
    callsRef.count,
    1 + MAX_CONTINUATION_NUDGES,
    'provider called 1 + MAX_CONTINUATION_NUDGES times',
  )
  assert.equal(
    events.filter(e => e.type === 'continuation_nudge').length,
    MAX_CONTINUATION_NUDGES,
  )
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: true })
})

test('runRuntimeTurn does not nudge when text contains completion markers', async () => {
  const { provider, callsRef } = textProvider([
    [
      { type: 'text', delta: "I'll edit the file. Done." },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'x' }],
      rebuildMessages: () => [{ role: 'user', content: 'x' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.equal(callsRef.count, 1)
  assert.equal(events.filter(e => e.type === 'continuation_nudge').length, 0)
})

test('runRuntimeTurn yields cancelled + done when signal aborts mid-stream', async () => {
  const controller = new AbortController()
  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(_messages, signal): AsyncIterable<StreamEvent> {
      yield { type: 'text', delta: 'start' }
      controller.abort()
      if (signal.aborted) return
      yield { type: 'done', stopReason: 'end_turn' }
    },
  }

  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: controller.signal,
      initialMessages: [{ role: 'user', content: 'x' }],
      rebuildMessages: () => [{ role: 'user', content: 'x' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.ok(events.some(e => e.type === 'cancelled'))
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: false })
})

test('runRuntimeTurn surfaces provider errors without nudging', async () => {
  const { provider, callsRef } = textProvider([
    [
      { type: 'error', message: 'boom' },
    ],
  ])

  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'x' }],
      rebuildMessages: () => [{ role: 'user', content: 'x' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.equal(callsRef.count, 1)
  assert.ok(events.some(e => e.type === 'error' && e.message === 'boom'))
  const done = events.at(-1)
  assert.deepEqual(done, { type: 'done', finishedNormally: false })
})

test('looksLikeContinuationIntent detects short action-verb phrases', () => {
  assert.equal(looksLikeContinuationIntent("Now I'll create the file."), true)
  assert.equal(looksLikeContinuationIntent('Let me edit this.'), true)
  assert.equal(looksLikeContinuationIntent('Time to implement the fix.'), true)
})

test('looksLikeContinuationIntent returns false on completion markers', () => {
  assert.equal(
    looksLikeContinuationIntent("I'll update it. All set — let me know if anything else is needed."),
    false,
  )
  assert.equal(looksLikeContinuationIntent('Done.'), false)
  assert.equal(looksLikeContinuationIntent('That is all.'), false)
})

test('looksLikeContinuationIntent ignores explanatory text without action verbs', () => {
  assert.equal(
    looksLikeContinuationIntent('This approach is simpler because it avoids state.'),
    false,
  )
  assert.equal(looksLikeContinuationIntent('I think you should try reading the file.'), false)
})

test('parseLocalModelTextToolUse accepts only exact local-model tool payloads', () => {
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '{\n  "name": "list_directory",\n  "arguments": {}\n}',
      2,
    ),
    { id: 'local-text-tool-2', name: 'list_directory', input: {} },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '```json\n{"name":"list_directory","arguments":{"path":"."}}\n```',
    ),
    { id: 'local-text-tool-0', name: 'list_directory', input: { path: '.' } },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '<tool_call>{"name":"list_directory","arguments":{}}</tool_call>',
    ),
    { id: 'local-text-tool-0', name: 'list_directory', input: {} },
  )
})

test('parseLocalModelTextToolUse rejects unsafe or non-local text', () => {
  const cases = [
    [{ id: 'openai' }, '{"name":"list_directory","arguments":{}}'],
    [{ id: 'ollama' }, 'Sure.\n{"name":"list_directory","arguments":{}}'],
    [{ id: 'ollama' }, '{"name":"missing_tool","arguments":{}}'],
    [{ id: 'ollama' }, '{"name":"list_directory","arguments":"."}'],
    [{ id: 'ollama' }, '{"name":"list_directory","arguments":{}'],
  ] as const

  for (const [provider, text] of cases) {
    assert.equal(parseLocalModelTextToolUse(provider, text), null)
  }
})
