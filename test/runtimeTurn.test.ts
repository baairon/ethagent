import test from 'node:test'
import assert from 'node:assert/strict'
import type { Message, Provider, StreamEvent } from '../src/providers/contracts.js'
import {
  MAX_CONTINUATION_NUDGES,
  looksLikeContinuationIntent,
  looksLikeFakeToolProtocolText,
  looksLikeToolDelegationText,
  looksLikeToolCapabilityConfusion,
  looksLikeToolStateClaimWithoutTool,
  parseLocalModelTextToolUse,
  parseLocalModelTextToolUses,
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
  assert.ok(events.some(e => e.type === 'local_tool_recovery'))
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('"name": "list_directory"'),
  ))
})

test('runRuntimeTurn converts multiple standalone Ollama JSON tool lines into tool uses', async () => {
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'text',
        delta: [
          'My apologies for that oversight. Let me change directories for you properly.',
          '',
          '{"name":"change_directory","arguments":{"path":"~/Downloads/ethagent"}}',
          '{"name":"read_file","arguments":{"path":"."}}',
        ].join('\n'),
      },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      { type: 'text', delta: 'Tool calls completed.' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  const executedTools: string[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'change directory then inspect' }],
      rebuildMessages: () => [{ role: 'user', content: 'change directory then inspect' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: `${t.name} ok`, content: 'ok' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 2)
  assert.deepEqual(executedTools, ['change_directory', 'read_file'])
  assert.equal(events.filter(e => e.type === 'tool_use_stop').length, 2)
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('"name":"change_directory"'),
  ))
})

test('runRuntimeTurn nudges local models that claim directory changes before tool use', async () => {
  const { provider, callsRef } = textProvider([
    [
      { type: 'text', delta: 'I am now in the identity directory. Is there something specific you would like to do next?' },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'change_directory',
        input: { path: 'identity' },
      },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text', delta: 'Now the directory change is complete.' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  const executedTools: string[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'yes' }],
      rebuildMessages: () => [{ role: 'user', content: 'yes' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: 'changed directory', content: '/tmp/identity' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 3)
  assert.deepEqual(executedTools, ['change_directory'])
  const nudge = events.find(e => e.type === 'continuation_nudge')
  assert.deepEqual(nudge, { type: 'continuation_nudge', attempt: 1, reason: 'tool_state_claim' })
})

test('runRuntimeTurn rejects unsupported missing-path claims and retries without reinforcing them', async () => {
  const seenMessages: Message[][] = []
  let calls = 0
  const provider: Provider = {
    id: 'ollama',
    model: 'qwen-test',
    supportsTools: true,
    async *complete(messages): AsyncIterable<StreamEvent> {
      seenMessages.push(messages)
      calls += 1
      if (calls === 1) {
        yield {
          type: 'text',
          delta: 'It appears that the directory identity does not exist in your current working directory.',
        }
        yield { type: 'done', stopReason: 'end_turn' }
        return
      }
      if (calls === 2) {
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

  const executedTools: string[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'cd into identity' }],
      rebuildMessages: () => [{ role: 'user', content: 'cd into identity' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: 'changed directory', content: '/tmp/identity' },
          })),
        }
      },
    }),
  )

  assert.equal(calls, 3)
  assert.deepEqual(executedTools, ['change_directory'])
  assert.deepEqual(
    events.find(e => e.type === 'continuation_nudge'),
    { type: 'continuation_nudge', attempt: 1, reason: 'tool_state_claim' },
  )
  assert.doesNotMatch(JSON.stringify(seenMessages[1]), /does not exist/)
  assert.match(JSON.stringify(seenMessages[1]), /Call the tool now/)
})

test('runRuntimeTurn nudges local models that claim they cannot use available tools', async () => {
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'text',
        delta: "I don't have direct access to running shell commands on your local machine.",
      },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'run_bash',
        input: { command: 'ls ./bin' },
      },
      { type: 'done', stopReason: 'tool_use' },
    ],
    [
      { type: 'text', delta: 'bin contains ethagent.js.' },
      { type: 'done', stopReason: 'end_turn' },
    ],
  ])

  const executedTools: string[] = []
  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'run ls ./bin' }],
      rebuildMessages: () => [{ role: 'user', content: 'run ls ./bin' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: 'ran ls ./bin', content: 'ethagent.js' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 3)
  assert.deepEqual(executedTools, ['run_bash'])
  assert.deepEqual(
    events.find(e => e.type === 'continuation_nudge'),
    { type: 'continuation_nudge', attempt: 1, reason: 'tool_capability' },
  )
})

test('runRuntimeTurn nudges fake local tool protocol text instead of persisting it', async () => {
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'text',
        delta: 'Sure! Let\'s list the current directory contents first.\n\n```code\nchange_directory,edit_file,list_directory,read_file,run_bash,write_file\n```',
      },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'list_directory',
        input: {},
      },
      { type: 'done', stopReason: 'tool_use' },
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
            result: { ok: true, summary: 'listed .', content: 'package.json' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 3)
  assert.deepEqual(executedTools, ['list_directory'])
  assert.deepEqual(
    events.find(e => e.type === 'continuation_nudge'),
    { type: 'continuation_nudge', attempt: 1, reason: 'tool_protocol_fake' },
  )
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('change_directory,edit_file'),
  ))
})

test('runRuntimeTurn nudges native tool delegation prose instead of persisting it', async () => {
  const { provider, callsRef } = textProvider([
    [
      {
        type: 'text',
        delta: 'Before proceeding with the plan, let\'s inspect the directory structure. Please run list_directory to see what files are available in the current working directory.',
      },
      { type: 'done', stopReason: 'end_turn' },
    ],
    [
      {
        type: 'tool_use_stop',
        id: 'tool-1',
        name: 'list_directory',
        input: {},
      },
      { type: 'done', stopReason: 'tool_use' },
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
      initialMessages: [{ role: 'user', content: 'implement the plan' }],
      rebuildMessages: () => [{ role: 'user', content: 'implement the plan' }],
      runToolBatch: async pending => {
        executedTools.push(...pending.map(t => t.name))
        return {
          cancelled: false,
          completedTools: pending.map(t => ({
            ...t,
            cwd: '/tmp',
            result: { ok: true, summary: 'listed .', content: 'package.json' },
          })),
        }
      },
    }),
  )

  assert.equal(callsRef.count, 3)
  assert.deepEqual(executedTools, ['list_directory'])
  assert.deepEqual(
    events.find(e => e.type === 'continuation_nudge'),
    { type: 'continuation_nudge', attempt: 1, reason: 'tool_delegation' },
  )
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('Please run list_directory'),
  ))
})

test('runRuntimeTurn errors after repeated native tool delegation prose', async () => {
  const responses: Array<StreamEvent[]> = []
  for (let i = 0; i < MAX_CONTINUATION_NUDGES + 1; i += 1) {
    responses.push([
      {
        type: 'text',
        delta: 'Please run list_directory to inspect the current working directory.',
      },
      { type: 'done', stopReason: 'end_turn' },
    ])
  }
  const { provider, callsRef } = textProvider(responses)

  const events = await collect(
    runRuntimeTurn({
      provider,
      signal: new AbortController().signal,
      initialMessages: [{ role: 'user', content: 'inspect files' }],
      rebuildMessages: () => [{ role: 'user', content: 'inspect files' }],
      runToolBatch: async () => ({ cancelled: false, completedTools: [] }),
    }),
  )

  assert.equal(callsRef.count, 1 + MAX_CONTINUATION_NUDGES)
  assert.equal(
    events.filter(e => e.type === 'continuation_nudge' && e.reason === 'tool_delegation').length,
    MAX_CONTINUATION_NUDGES,
  )
  assert.ok(events.some(e =>
    e.type === 'error' && e.message === 'model asked the user to run a tool instead of making a tool call',
  ))
  assert.ok(events.every(e =>
    e.type !== 'assistant_message_committed' || !e.text.includes('Please run list_directory'),
  ))
  assert.deepEqual(events.at(-1), { type: 'done', finishedNormally: false })
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

test('parseLocalModelTextToolUse accepts single local-model tool payloads', () => {
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
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      'Run the following command:\n\n```bash\n01 {"name":"run_bash","arguments":{"command":"ls ./bin"}}\n```\n',
    ),
    { id: 'local-text-tool-0', name: 'run_bash', input: { command: 'ls ./bin' } },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      [
        'Here is the directory listing:',
        '',
        '```code',
        'README.md  identity  plans',
        '```',
        '',
        'Next, I will change directories.',
        '',
        '```json',
        '{"name":"change_directory","arguments":{"path":"identity"}}',
        '```',
      ].join('\n'),
    ),
    { id: 'local-text-tool-0', name: 'change_directory', input: { path: 'identity' } },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '{"type":"function","function":{"name":"read_file","arguments":"{\\"path\\":\\"package.json\\"}"}}',
    ),
    { id: 'local-text-tool-0', name: 'read_file', input: { path: 'package.json' } },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '{"tool_calls":[{"function":{"name":"list_directory","arguments":{"path":"src"}}}]}',
    ),
    { id: 'local-text-tool-0', name: 'list_directory', input: { path: 'src' } },
  )
  assert.deepEqual(
    parseLocalModelTextToolUse(
      { id: 'ollama' },
      '[{"tool_name":"list_directory","parameters":{"path":"test"}}]',
    ),
    { id: 'local-text-tool-0', name: 'list_directory', input: { path: 'test' } },
  )
})

test('parseLocalModelTextToolUses accepts multiple standalone local-model tool payloads', () => {
  assert.deepEqual(
    parseLocalModelTextToolUses(
      { id: 'ollama' },
      [
        'My apologies for that oversight. Let me change directories for you properly.',
        '',
        '{"name":"change_directory","arguments":{"path":"~/Downloads/ethagent"}}',
        '{"name":"read_file","arguments":{"path":"."}}',
      ].join('\n'),
    ),
    [
      { id: 'local-text-tool-0-0', name: 'change_directory', input: { path: '~/Downloads/ethagent' } },
      { id: 'local-text-tool-0-1', name: 'read_file', input: { path: '.' } },
    ],
  )
})

test('parseLocalModelTextToolUse rejects unsafe or non-local text', () => {
  const cases = [
    [{ id: 'openai' }, '{"name":"list_directory","arguments":{}}'],
    [{ id: 'ollama' }, 'Sure, use {"name":"list_directory","arguments":{}}'],
    [{ id: 'ollama' }, '```bash\n{"name":"list_directory","arguments":{}}\n```\n```bash\n{"name":"read_file","arguments":{"path":"package.json"}}\n```'],
    [{ id: 'ollama' }, '{"name":"missing_tool","arguments":{}}'],
    [{ id: 'ollama' }, '{"name":"list_directory","arguments":"."}'],
    [{ id: 'ollama' }, '{"name":"list_directory","arguments":{}'],
  ] as const

  for (const [provider, text] of cases) {
    assert.equal(parseLocalModelTextToolUse(provider, text), null)
  }
})

test('looksLikeToolCapabilityConfusion detects false local-tool limitations', () => {
  assert.equal(
    looksLikeToolCapabilityConfusion("I don't have direct access to running shell commands on your local machine."),
    true,
  )
  assert.equal(
    looksLikeToolCapabilityConfusion('I cannot inspect local files unless you share the contents here.'),
    true,
  )
  assert.equal(looksLikeToolCapabilityConfusion('This is a limitation of the API design.'), false)
})

test('looksLikeFakeToolProtocolText detects printed tool menus', () => {
  assert.equal(
    looksLikeFakeToolProtocolText('```code\nchange_directory,edit_file,list_directory,read_file,run_bash,write_file\n```'),
    true,
  )
  assert.equal(looksLikeFakeToolProtocolText('I will use read_file next.'), false)
})

test('looksLikeToolDelegationText detects native tool requests in prose', () => {
  assert.equal(
    looksLikeToolDelegationText('Please run list_directory to see what files are available.'),
    true,
  )
  assert.equal(
    looksLikeToolDelegationText('Before proceeding, I will use read_file to inspect package.json.'),
    true,
  )
  assert.equal(looksLikeToolDelegationText('The list_directory tool exists.'), false)
})

test('looksLikeToolStateClaimWithoutTool detects directory-change claims', () => {
  assert.equal(
    looksLikeToolStateClaimWithoutTool('I am now in the identity directory.'),
    true,
  )
  assert.equal(
    looksLikeToolStateClaimWithoutTool('The current working directory has been changed to /tmp/app.'),
    true,
  )
  assert.equal(
    looksLikeToolStateClaimWithoutTool('The identity directory exists in this repository.'),
    true,
  )
})
