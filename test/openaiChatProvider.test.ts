import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIChatProvider, toWireMessages } from '../src/providers/openai-chat.js'
import type { StreamEvent } from '../src/providers/contracts.js'

test('OpenAIChatProvider finalizes collected tool calls even when finish_reason is stop', async () => {
  const originalFetch = globalThis.fetch
  const chunks = [
    'data: ' + JSON.stringify({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-1',
            type: 'function',
            function: { name: 'list_directory', arguments: '{"path":"."}' },
          }],
        },
      }],
    }),
    'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    'data: [DONE]',
  ].join('\n\n')

  globalThis.fetch = (async () => new Response(chunks, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })) as typeof fetch

  try {
    const provider = new OpenAIChatProvider({
      id: 'ollama',
      model: 'qwen-test',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      tools: [{
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'list',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }],
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'list files' }], new AbortController().signal)) {
      events.push(event)
    }

    assert.ok(events.some(event =>
      event.type === 'tool_use_stop' &&
      event.name === 'list_directory' &&
      event.input.path === '.',
    ))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenAIChatProvider includes local provider and base URL in fetch errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch

  try {
    const provider = new OpenAIChatProvider({
      id: 'llamacpp',
      model: 'org/model#model.gguf',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'llamacpp',
      maxRetries: 0,
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'hello' }], new AbortController().signal)) {
      events.push(event)
    }

    const error = events.find(event => event.type === 'error')
    assert.ok(error)
    assert.match(error.message, /llamacpp/)
    assert.match(error.message, /http:\/\/localhost:8080\/v1/)
    assert.match(error.message, /fetch failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('toWireMessages keeps system content in one leading message', () => {
  const messages = toWireMessages([
    { role: 'system', content: 'base instructions' },
    { role: 'user', content: 'hello' },
    { role: 'system', content: 'correction context' },
    { role: 'assistant', content: 'hi' },
  ])

  assert.equal(messages[0]?.role, 'system')
  assert.equal(messages[0]?.content, 'base instructions\n\ncorrection context')
  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant'])
})

test('toWireMessages preserves tool call and result wire shapes while moving systems', () => {
  const messages = toWireMessages([
    { role: 'user', content: 'list files' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'list_directory', input: { path: '.' } }] },
    { role: 'system', content: 'late system context' },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tool-1', content: 'README.md' }] },
  ])

  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant', 'tool'])
  assert.equal(messages[0]?.content, 'late system context')
  assert.deepEqual(messages[2]?.tool_calls, [{
    id: 'tool-1',
    type: 'function',
    function: {
      name: 'list_directory',
      arguments: '{"path":"."}',
    },
  }])
  assert.equal(messages[3]?.tool_call_id, 'tool-1')
  assert.equal(messages[3]?.content, 'README.md')
})
