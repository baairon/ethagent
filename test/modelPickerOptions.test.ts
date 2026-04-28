import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildModelPickerOptions,
  orderModelsForContextFit,
  type CloudProviderId,
  type ModelPickerOptionsData,
} from '../src/ui/modelPickerOptions.js'
import type { ModelCatalogEntry, ModelCatalogResult } from '../src/models/catalog.js'
import type { ProviderId } from '../src/storage/config.js'

function entry(provider: CloudProviderId, id: string): ModelCatalogEntry {
  return {
    provider,
    id,
    label: id,
    source: 'discovered',
  }
}

function catalog(provider: CloudProviderId, ids: string[]): ModelCatalogResult {
  return {
    provider,
    status: 'ok',
    entries: ids.map(id => entry(provider, id)),
  }
}

function baseData(overrides: Partial<ModelPickerOptionsData> = {}): ModelPickerOptionsData {
  return {
    daemonUp: true,
    models: [],
    cloudKeys: {
      openai: true,
      anthropic: false,
      gemini: false,
    },
    cloudCatalogs: {
      openai: catalog('openai', ['gpt-4o', 'gpt-5', 'gpt-5.2', 'gpt-4.1']),
    },
    ...overrides,
  }
}

function valuesFor(options: Array<{ value: string }>, provider: CloudProviderId): string[] {
  return options
    .map(option => option.value)
    .filter(value => value.startsWith(`c:${provider}:`))
    .map(value => value.slice(`c:${provider}:`.length))
}

function optionByValue<T extends { value: string }>(options: T[], value: string): T {
  const option = options.find(candidate => candidate.value === value)
  assert.ok(option, `expected option ${value}`)
  return option
}

test('OpenAI picker shows the three most recent catalog models', () => {
  const options = buildModelPickerOptions(baseData(), {
    currentProvider: 'openai',
    currentModel: 'gpt-4o',
  })

  assert.deepEqual(valuesFor(options, 'openai'), ['gpt-5.2', 'gpt-5', 'gpt-4.1'])
  assert.equal(options.some(option => option.value === 'c:openai:gpt-4o'), false)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').hint, undefined)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').label, 'gpt-5.2')
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').indent, 4)
})

test('OpenAI picker excludes preview and deep-research models before recency ranking', () => {
  const options = buildModelPickerOptions(baseData({
    cloudCatalogs: {
      openai: catalog('openai', [
        'gpt-5.2',
        'o3-deep-research-2025-06-26',
        'o4-mini-deep-research-2025-06-26',
        'gpt-5.4-nano',
        'gpt-5.5-preview',
      ]),
    },
  }), {
    currentProvider: 'ollama' as ProviderId,
    currentModel: 'qwen2.5-coder:7b',
  })

  assert.deepEqual(valuesFor(options, 'openai'), ['gpt-5.4-nano', 'gpt-5.2'])
  assert.equal(options.some(option => option.value.includes('deep-research')), false)
  assert.equal(options.some(option => option.value.includes('preview')), false)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.4-nano').hint, undefined)
})

test('cloud providers show curated catalog rows when they are not active', () => {
  const options = buildModelPickerOptions(baseData({
    cloudKeys: {
      openai: true,
      anthropic: true,
      gemini: true,
    },
    cloudCatalogs: {
      openai: catalog('openai', ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4o']),
      anthropic: catalog('anthropic', [
        'claude-3-5-haiku-20241022',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-20250514',
      ]),
      gemini: catalog('gemini', [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'learnlm-2.0-flash',
        'deep-research-pro-preview-12-2025',
        'gemini-3.1-flash-lite-preview',
        'gemini-3.1-flash-tts-preview',
        'gemini-3.0-dev',
        'gemini-3.0-test',
      ]),
    },
  }), {
    currentProvider: 'ollama' as ProviderId,
    currentModel: 'qwen2.5-coder:7b',
  })

  assert.deepEqual(valuesFor(options, 'openai'), ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'])
  assert.deepEqual(valuesFor(options, 'anthropic'), [
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-1-20250805',
    'claude-sonnet-4-20250514',
  ])
  assert.deepEqual(valuesFor(options, 'gemini'), [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
  ])
  assert.equal(optionByValue(options, 'c:openai:gpt-5.4').hint, undefined)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.4').label, 'gpt-5.4')
  assert.equal(optionByValue(options, 'hdr:cloud:openai').label, 'openai')
  assert.equal(optionByValue(options, 'hdr:cloud:gemini').label, 'gemini')
})

test('custom OpenAI-compatible catalogs remain selectable when model families are unknown', () => {
  const options = buildModelPickerOptions(baseData({
    cloudCatalogs: {
      openai: catalog('openai', ['llama-3.1-70b-instruct', 'mixtral-large', 'my-fast-chat', 'custom-legacy']),
    },
  }), {
    currentProvider: 'ollama' as ProviderId,
    currentModel: 'qwen2.5-coder:7b',
  })

  assert.deepEqual(valuesFor(options, 'openai'), ['llama-3.1-70b-instruct', 'mixtral-large', 'my-fast-chat'])
})

test('picker options expose grouped catalog and key management for keyed and unkeyed providers', () => {
  const options = buildModelPickerOptions(baseData({
    cloudKeys: {
      openai: true,
      anthropic: false,
      gemini: false,
    },
  }), {
    currentProvider: 'openai',
    currentModel: 'gpt-5.2',
  })

  assert.equal(optionByValue(options, 'key:manage:openai').label, 'api key - manage')
  assert.equal(optionByValue(options, 'catalog:openai').label, 'full catalog')
  assert.equal(optionByValue(options, 'catalog:openai').role, 'utility')
  assert.equal(optionByValue(options, 'catalog:openai').indent, 4)
  assert.equal(optionByValue(options, 'key:manage:openai').role, 'utility')
  assert.equal(optionByValue(options, 'key:manage:openai').indent, 4)
  assert.equal(optionByValue(options, 'key:set:anthropic').label, 'api key - add')
  assert.equal(optionByValue(options, 'key:set:anthropic').role, 'utility')
  assert.equal(optionByValue(options, 'key:set:anthropic').indent, 4)
  assert.equal(options.some(option => option.value === 'key:set:openai'), false)
  assert.equal(options.some(option => option.value === 'key:edit:openai'), false)
  assert.equal(options.some(option => option.value === 'key:delete:openai'), false)
  assert.equal(options.some(option => option.value === 'key:delete:anthropic'), false)
  assert.equal(options.some(option => option.value === 'catalog:anthropic'), false)
  assert.ok(
    options.findIndex(option => option.value === 'catalog:openai')
      < options.findIndex(option => option.value === 'key:manage:openai'),
  )
})

test('picker hierarchy uses provider group labels without repeated provider prefixes', () => {
  const options = buildModelPickerOptions(baseData(), {
    currentProvider: 'openai',
    currentModel: 'gpt-5.2',
  })

  assert.equal(optionByValue(options, 'hdr:cloud').role, 'section')
  assert.equal(optionByValue(options, 'hdr:cloud').bold, true)
  assert.equal(optionByValue(options, 'hdr:cloud:openai').role, 'group')
  assert.equal(optionByValue(options, 'hdr:cloud:openai').disabled, true)
  assert.equal(optionByValue(options, 'hdr:cloud:openai').indent, 2)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').prefix, undefined)
  assert.equal(optionByValue(options, 'key:manage:openai').prefix, undefined)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').labelColor, undefined)
  assert.equal(optionByValue(options, 'c:openai:gpt-5.2').label.startsWith('openai'), false)
})

test('empty keyed cloud catalogs show no selectable model rows', () => {
  const options = buildModelPickerOptions(baseData({
    cloudCatalogs: {
      openai: catalog('openai', []),
    },
  }), {
    currentProvider: 'ollama' as ProviderId,
    currentModel: 'qwen2.5-coder:7b',
  })

  assert.deepEqual(valuesFor(options, 'openai'), [])
  assert.equal(optionByValue(options, 'hdr:cloud-empty:openai').label, 'no selectable models')
  assert.equal(optionByValue(options, 'hdr:cloud-empty:openai').indent, 4)
})

test('fallback catalogs show provider-level notice and still expose the configured model', () => {
  const options = buildModelPickerOptions(baseData({
    cloudKeys: {
      openai: false,
      anthropic: false,
      gemini: true,
    },
    cloudCatalogs: {
      gemini: {
        provider: 'gemini',
        status: 'fallback',
        error: 'HTTP 400',
        entries: [{ ...entry('gemini', 'gemini-2.0-flash'), source: 'fallback' }],
      },
    },
  }), {
    currentProvider: 'gemini',
    currentModel: 'gemini-2.0-flash',
  })

  assert.equal(
    optionByValue(options, 'hdr:cloud-fallback:gemini').label,
    'catalog unavailable - HTTP 400 - showing configured model',
  )
  assert.deepEqual(valuesFor(options, 'gemini'), ['gemini-2.0-flash'])
  assert.equal(optionByValue(options, 'c:gemini:gemini-2.0-flash').hint, undefined)
})

test('context fit mode ranks larger fitting models before over-limit local models', () => {
  const ordered = orderModelsForContextFit(
    'ollama',
    ['qwen2.5-coder:7b', 'llama3.1:8b'],
    { usedTokens: 32_000, thresholdPercent: 90 },
  )

  assert.deepEqual(ordered, ['llama3.1:8b', 'qwen2.5-coder:7b'])
})

test('context fit mode annotates projected usage and prefers larger cloud windows', () => {
  const options = buildModelPickerOptions(baseData({
    models: [
      { name: 'qwen2.5-coder:7b', sizeBytes: 4_700_000_000 },
      { name: 'llama3.1:8b', sizeBytes: 4_900_000_000 },
    ],
    cloudKeys: {
      openai: true,
      anthropic: true,
      gemini: false,
    },
    cloudCatalogs: {
      openai: catalog('openai', ['gpt-5.2', 'gpt-4o', 'gpt-4.1']),
      anthropic: catalog('anthropic', ['claude-sonnet-4-5-20250929']),
    },
  }), {
    currentProvider: 'ollama' as ProviderId,
    currentModel: 'qwen2.5-coder:7b',
    contextFit: { usedTokens: 32_000, thresholdPercent: 90 },
  })

  const localValues = options
    .map(option => option.value)
    .filter(value => value.startsWith('ol:'))
    .map(value => value.slice(3))
  assert.deepEqual(localValues, ['llama3.1:8b', 'qwen2.5-coder:7b'])
  assert.match(optionByValue(options, 'ol:llama3.1:8b').label, /128k ctx 25%/)
  assert.match(optionByValue(options, 'ol:qwen2.5-coder:7b').label, /33k ctx 98%/)
  assert.equal(valuesFor(options, 'openai')[0], 'gpt-4.1')
  assert.match(optionByValue(options, 'c:openai:gpt-4.1').label, /1m ctx 3%/)
  assert.match(optionByValue(options, 'c:anthropic:claude-sonnet-4-5-20250929').label, /200k ctx 16%/)
})
