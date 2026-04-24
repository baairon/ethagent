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
  assert.deepEqual(result.entries.map(entry => entry.id), ['gpt-a', 'gpt-b'])
  assert.deepEqual(urls, [
    'https://compat.example/v1/models',
    'https://compat.example/models',
  ])
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
