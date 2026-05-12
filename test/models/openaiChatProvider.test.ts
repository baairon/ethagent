import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIChatProvider, toWireMessages } from '../../src/providers/openai-chat.js'
import type { StreamEvent } from '../../src/providers/contracts.js'

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
      id: 'llamacpp',
      model: 'qwen-test',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'llamacpp',
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

test('OpenAIChatProvider separates llama.cpp think-tag content into reasoning events', async () => {
  const originalFetch = globalThis.fetch
  const chunks = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: '<thi' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'nk>private ' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'steps</th' } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ink>final answer' } }] }),
    'data: [DONE]',
  ].join('\n\n')

  globalThis.fetch = (async () => new Response(chunks, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })) as typeof fetch

  try {
    const provider = new OpenAIChatProvider({
      id: 'llamacpp',
      model: 'org/model#model.gguf',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'llamacpp',
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'think' }], new AbortController().signal)) {
      events.push(event)
    }

    assert.equal(
      events.filter(event => event.type === 'thinking').map(event => event.delta).join(''),
      'private steps',
    )
    assert.equal(
      events.filter(event => event.type === 'text').map(event => event.delta).join(''),
      'final answer',
    )
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
    assert.match(error.message, /llama\.cpp/)
    assert.match(error.message, /http:\/\/localhost:8080\/v1/)
    assert.match(error.message, /fetch failed/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('toWireMessages keeps system content in one leading message', async () => {
  const messages = await toWireMessages([
    { role: 'system', content: 'base instructions' },
    { role: 'user', content: 'hello' },
    { role: 'system', content: 'correction context' },
    { role: 'assistant', content: 'hi' },
  ])

  assert.equal(messages[0]?.role, 'system')
  assert.equal(messages[0]?.content, 'base instructions\n\ncorrection context')
  assert.deepEqual(messages.map(message => message.role), ['system', 'user', 'assistant'])
})

test('toWireMessages preserves tool call and result wire shapes while moving systems', async () => {
  const messages = await toWireMessages([
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

test('OpenAIChatProvider gates llamacpp images on hasVisionProjector, not on model name', async () => {
  const originalFetch = globalThis.fetch
  let fetched = false
  globalThis.fetch = (async () => {
    fetched = true
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  try {
    const provider = new OpenAIChatProvider({
      id: 'llamacpp',
      model: 'llava-1.6-mistral-7b.Q4_K_M.gguf',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'llamacpp',
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([
      { role: 'user', content: [{ type: 'image', path: '/tmp/x.png', mimeType: 'image/png', dataBase64: 'AAAA' }] },
    ], new AbortController().signal)) {
      events.push(event)
    }
    const error = events.find(event => event.type === 'error')
    assert.ok(error, 'expected an error event')
    assert.match(error?.type === 'error' ? error.message : '', /no vision projector loaded/)
    assert.equal(fetched, false, 'should not contact the server when gate fires')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('OpenAIChatProvider passes images when hasVisionProjector is true', async () => {
  const originalFetch = globalThis.fetch
  let body: string | null = null
  globalThis.fetch = (async (_url: unknown, init: RequestInit | undefined) => {
    body = typeof init?.body === 'string' ? init.body : null
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  try {
    const provider = new OpenAIChatProvider({
      id: 'llamacpp',
      model: 'llava-1.6-mistral-7b.Q4_K_M.gguf',
      baseUrl: 'http://localhost:8080/v1',
      apiKey: 'llamacpp',
      hasVisionProjector: true,
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([
      { role: 'user', content: [{ type: 'image', path: '/tmp/x.png', mimeType: 'image/png', dataBase64: 'AAAA' }] },
    ], new AbortController().signal)) {
      events.push(event)
    }
    const errors = events.filter(event => event.type === 'error')
    assert.equal(errors.length, 0, `expected no errors, got: ${errors.map(e => e.type === 'error' ? e.message : '').join('; ')}`)
    assert.ok(body !== null, 'expected request body')
    assert.match(body ?? '', /image_url/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
