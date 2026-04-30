import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AnthropicProvider } from '../src/providers/anthropic.js'
import { GeminiProvider } from '../src/providers/gemini.js'
import { OpenAIChatProvider } from '../src/providers/openai-chat.js'
import type { Provider, StreamEvent } from '../src/providers/contracts.js'
import { setKey } from '../src/storage/secrets.js'

async function collect(provider: Provider): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of provider.complete([{ role: 'user', content: 'hello' }], new AbortController().signal)) {
    events.push(event)
  }
  return events
}

test('OpenAI-compatible provider emits retry events before streamed text', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) {
      return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
    }
    return new Response(openAiSse('openai ready'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch

  try {
    const provider = new OpenAIChatProvider({
      id: 'openai',
      model: 'gpt-test',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'test-key',
      maxRetries: 1,
    })
    const events = await collect(provider)

    assert.equal(calls, 2)
    assert.deepEqual(events.map(event => event.type), ['retry', 'text', 'done'])
    assert.deepEqual(events[0], {
      type: 'retry',
      attempt: 1,
      nextAttempt: 2,
      maxRetries: 1,
      delayMs: 0,
      reason: 'HTTP 503',
      retryAfterMs: 0,
      status: 503,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Anthropic provider emits retry events through the shared retry path', async () => {
  await withHome(async () => {
    await setKey('anthropic', 'test-key')
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      }
      return new Response(anthropicSse('anthropic ready'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const provider = new AnthropicProvider({ model: 'claude-test' })
      const events = await collect(provider)

      assert.equal(calls, 2)
      assert.deepEqual(events.map(event => event.type), ['retry', 'text', 'done'])
      assert.equal(events[0]?.type, 'retry')
      assert.equal(events[1]?.type === 'text' ? events[1].delta : '', 'anthropic ready')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('Gemini provider retries transient fetch responses and reports status', async () => {
  await withHome(async () => {
    await setKey('gemini', 'test-key')
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response('busy', { status: 503, headers: { 'retry-after': '0' } })
      }
      return new Response(geminiSse('gemini ready'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const provider = new GeminiProvider({ model: 'models/gemini-test' })
      const events = await collect(provider)

      assert.equal(calls, 2)
      assert.deepEqual(events.map(event => event.type), ['retry', 'text', 'done'])
      assert.equal(events[0]?.type, 'retry')
      assert.equal(events[1]?.type === 'text' ? events[1].delta : '', 'gemini ready')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

function openAiSse(text: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
    'data: [DONE]',
  ].join('\n\n')
}

function anthropicSse(text: string): string {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
  ].join('\n\n')
}

function geminiSse(text: string): string {
  return [
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    })}`,
  ].join('\n\n')
}

async function withHome(fn: () => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-provider-retry-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn()
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  }
}
