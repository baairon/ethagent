import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIResponsesProvider } from '../../src/providers/openai-responses.js'
import type { StreamEvent } from '../../src/providers/contracts.js'

function ssePayload(events: Array<{ event: string; data: Record<string, unknown> }>): string {
  return events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}`).join('\n\n') + '\n\n'
}

test('Responses provider streams text deltas and a completed event', async () => {
  const originalFetch = globalThis.fetch
  const body = ssePayload([
    { event: 'response.output_text.delta', data: { delta: 'Hello ' } },
    { event: 'response.output_text.delta', data: { delta: 'world' } },
    { event: 'response.completed', data: { response: { usage: { input_tokens: 5, output_tokens: 2 } } } },
  ])

  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })) as typeof fetch

  try {
    const provider = new OpenAIResponsesProvider({
      model: 'gpt-5',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accessToken: 'at-test',
      accountId: 'acc-test',
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'hi' }], new AbortController().signal)) {
      events.push(event)
    }

    const text = events.filter(e => e.type === 'text').map(e => (e as { delta: string }).delta).join('')
    assert.equal(text, 'Hello world')
    const done = events.find(e => e.type === 'done')
    assert.ok(done, 'expected done event')
    if (done && done.type === 'done') {
      assert.equal(done.inputTokens, 5)
      assert.equal(done.outputTokens, 2)
      assert.equal(done.stopReason, 'end_turn')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Responses provider emits tool_use events from function_call streams', async () => {
  const originalFetch = globalThis.fetch
  const body = ssePayload([
    { event: 'response.output_item.added', data: { item: { type: 'function_call', call_id: 'call-1', name: 'list_dir' } } },
    { event: 'response.function_call_arguments.delta', data: { call_id: 'call-1', delta: '{"path":' } },
    { event: 'response.function_call_arguments.delta', data: { call_id: 'call-1', delta: '"."}' } },
    { event: 'response.output_item.done', data: { item: { type: 'function_call', call_id: 'call-1', name: 'list_dir', arguments: '{"path":"."}' } } },
    { event: 'response.completed', data: { response: { usage: { input_tokens: 7, output_tokens: 3 } } } },
  ])

  globalThis.fetch = (async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })) as typeof fetch

  try {
    const provider = new OpenAIResponsesProvider({
      model: 'gpt-5',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accessToken: 'at-test',
      tools: [{
        type: 'function',
        function: {
          name: 'list_dir',
          description: 'list',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      }],
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'list files' }], new AbortController().signal)) {
      events.push(event)
    }

    const stop = events.find(e => e.type === 'tool_use_stop')
    assert.ok(stop, 'expected tool_use_stop')
    if (stop && stop.type === 'tool_use_stop') {
      assert.equal(stop.name, 'list_dir')
      assert.deepEqual(stop.input, { path: '.' })
    }
    const done = events.find(e => e.type === 'done')
    assert.ok(done)
    if (done && done.type === 'done') {
      assert.equal(done.stopReason, 'tool_use')
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Responses provider sends Authorization and chatgpt-account-id headers', async () => {
  const originalFetch = globalThis.fetch
  let observed: Record<string, string> | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    observed = init?.headers as Record<string, string>
    const body = ssePayload([
      { event: 'response.completed', data: { response: { usage: { input_tokens: 0, output_tokens: 0 } } } },
    ])
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch

  try {
    const provider = new OpenAIResponsesProvider({
      model: 'gpt-5',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accessToken: 'at-test',
      accountId: 'acc-123',
    })
    for await (const _ of provider.complete([{ role: 'user', content: 'hi' }], new AbortController().signal)) { void _ }

    assert.ok(observed)
    assert.equal(observed!.Authorization, 'Bearer at-test')
    assert.equal(observed!['chatgpt-account-id'], 'acc-123')
    assert.equal(observed!.originator, 'codex_cli_rs')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Responses provider refreshes access token and retries on 401', async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  let seenSecondAuth: string | undefined
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    callCount += 1
    if (callCount === 1) {
      return new Response('{"error":{"message":"expired"}}', { status: 401, headers: { 'content-type': 'application/json' } })
    }
    seenSecondAuth = (init?.headers as Record<string, string>).Authorization
    const body = ssePayload([
      { event: 'response.output_text.delta', data: { delta: 'ok' } },
      { event: 'response.completed', data: { response: { usage: { input_tokens: 1, output_tokens: 1 } } } },
    ])
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch

  try {
    let refreshCalls = 0
    const provider = new OpenAIResponsesProvider({
      model: 'gpt-5',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      accessToken: 'stale-token',
      refresh: async () => {
        refreshCalls += 1
        return 'fresh-token'
      },
    })
    const events: StreamEvent[] = []
    for await (const event of provider.complete([{ role: 'user', content: 'hi' }], new AbortController().signal)) {
      events.push(event)
    }

    assert.equal(refreshCalls, 1)
    assert.equal(seenSecondAuth, 'Bearer fresh-token')
    const done = events.find(e => e.type === 'done')
    assert.ok(done, 'expected success after refresh')
  } finally {
    globalThis.fetch = originalFetch
  }
})
