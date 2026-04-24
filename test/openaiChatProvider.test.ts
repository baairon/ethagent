import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIChatProvider } from '../src/providers/openai-chat.js'
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
