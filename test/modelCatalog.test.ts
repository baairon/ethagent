import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearModelCatalogCache,
  discoverProviderModels,
} from '../src/models/catalog.js'
import type { EthagentConfig } from '../src/storage/config.js'

const baseConfig: EthagentConfig = {
  version: 1,
  provider: 'openai',
  model: 'current-model',
  firstRunAt: new Date(0).toISOString(),
}

test('OpenAI discovery dedupes models and falls back to the alternate URL', async () => {
  clearModelCatalogCache()
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)
    if (urls.length === 1) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify({
      data: [
        { id: 'gpt-a' },
        { id: 'gpt-a' },
        { id: 'llama-compatible' },
        { id: 'text-embedding-compatible' },
        { id: 'gpt-b' },
      ],
    }), { status: 200 })
  }) as typeof fetch

  const result = await discoverProviderModels(
    { ...baseConfig, baseUrl: 'https://compat.example/v1' },
    {
      fetchImpl,
      loadKey: async () => 'sk-test',
      now: () => 0,
    },
  )

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.entries.map(entry => entry.id), [
    'gpt-a',
    'llama-compatible',
    'text-embedding-compatible',
    'gpt-b',
  ])
  assert.deepEqual(urls, [
    'https://compat.example/v1/models',
    'https://compat.example/models',
  ])
})

test('OpenAI discovery filters non-chat models on the default endpoint', async () => {
  clearModelCatalogCache()
  const fetchImpl = (async () => new Response(JSON.stringify({
    data: [
      { id: 'gpt-4o' },
      { id: 'gpt-4o-mini' },
      { id: 'gpt-4.1' },
      { id: 'o1' },
      { id: 'o3-mini' },
      { id: 'o4-mini' },
      { id: 'chatgpt-4o-latest' },
      { id: 'gpt-3.5-turbo-instruct' },
      { id: 'gpt-4o-realtime-preview' },
      { id: 'gpt-4o-audio-preview' },
      { id: 'gpt-4o-mini-transcribe' },
      { id: 'gpt-4o-mini-tts' },
      { id: 'gpt-4o-search-preview' },
      { id: 'gpt-image-1' },
      { id: 'text-embedding-3-large' },
      { id: 'whisper-1' },
      { id: 'tts-1' },
      { id: 'dall-e-3' },
      { id: 'omni-moderation-latest' },
      { id: 'davinci' },
      { id: 'babbage-002' },
      { id: 'davinci-002' },
    ],
  }), { status: 200 })) as typeof fetch
  const result = await discoverProviderModels(
    baseConfig,
    {
      fetchImpl,
      loadKey: async () => 'sk-test',
      now: () => 0,
    },
  )

  assert.equal(result.status, 'ok')
  assert.deepEqual(
    result.entries.map(entry => entry.id),
    ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o1', 'o3-mini', 'o4-mini', 'chatgpt-4o-latest'],
  )
})

test('Anthropic discovery parses data ids', async () => {
  clearModelCatalogCache()
  const result = await discoverProviderModels(
    { ...baseConfig, provider: 'anthropic', model: 'claude-current' },
    {
      fetchImpl: (async () => new Response(JSON.stringify({
        data: [
          { id: 'claude-a' },
          { id: 'claude-b', display_name: 'Claude B' },
        ],
      }), { status: 200 })) as typeof fetch,
      loadKey: async () => 'sk-ant-test',
      now: () => 0,
    },
  )

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.entries.map(entry => entry.id), ['claude-a', 'claude-b'])
  assert.equal(result.entries[1]?.label, 'Claude B')
})

test('Gemini discovery filters generateContent models and strips the models prefix', async () => {
  clearModelCatalogCache()
  const result = await discoverProviderModels(
    { ...baseConfig, provider: 'gemini', model: 'gemini-current' },
    {
      fetchImpl: (async () => new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-chat', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] },
          { name: 'gemini-plain', supportedGenerationMethods: ['generateContent'] },
        ],
      }), { status: 200 })) as typeof fetch,
      loadKey: async () => 'AIza-test',
      now: () => 0,
    },
  )

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.entries.map(entry => entry.id), ['gemini-chat', 'gemini-plain'])
})

test('discovery failure returns current and default fallback models', async () => {
  clearModelCatalogCache()
  const result = await discoverProviderModels(
    { ...baseConfig, provider: 'anthropic', model: 'custom-claude' },
    {
      fetchImpl: (async () => {
        throw new Error('offline')
      }) as typeof fetch,
      loadKey: async () => 'sk-ant-test',
      now: () => 0,
    },
  )

  assert.equal(result.status, 'fallback')
  assert.deepEqual(result.entries.map(entry => entry.id), ['custom-claude', 'claude-sonnet-4-5'])
  assert.ok(result.entries.every(entry => entry.source === 'fallback'))
})
