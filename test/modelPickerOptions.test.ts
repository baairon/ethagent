import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLocalModelCatalogOptions,
  buildModelPickerOptions,
  catalogOptionValue,
  orderModelsForContextFit,
  type CloudProviderId,
  type ModelPickerOptionsData,
} from '../src/models/modelPickerOptions.js'
import {
  buildHfFileOptions,
  chooseInstalledHfModelForRepo,
} from '../src/models/ModelPicker.js'
import type { ModelCatalogEntry, ModelCatalogResult } from '../src/models/catalog.js'
import type { HuggingFaceRepoInfo, LocalHfModel } from '../src/models/huggingface.js'
import type { SpecSnapshot } from '../src/models/runtimeDetection.js'
import type { ProviderId } from '../src/storage/config.js'
import type { UncensoredCatalogEntry } from '../src/models/uncensoredCatalog.js'

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
    llamaCpp: {
      binaryPresent: false,
      serverUp: false,
    },
    hfModels: [],
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

function uncensoredCatalogEntry(overrides: Partial<UncensoredCatalogEntry> = {}): UncensoredCatalogEntry {
  const repo = hfRepo()
  return {
    repo,
    file: repo.siblings[0]!,
    fit: 'fits',
    recommended: true,
    installed: false,
    ...overrides,
  }
}

function machineSpec(overrides: Partial<SpecSnapshot> = {}): SpecSnapshot {
  return {
    platform: 'linux',
    arch: 'x64',
    cpuCores: 8,
    totalRamBytes: 12 * 1024 * 1024 * 1024,
    effectiveRamBytes: 12 * 1024 * 1024 * 1024,
    isAppleSilicon: false,
    gpuVramBytes: null,
    ...overrides,
  }
}

function hfRepo(): HuggingFaceRepoInfo {
  return {
    repoId: 'org/model',
    author: 'org',
    sha: '0123456789abcdef0123456789abcdef01234567',
    license: 'apache-2.0',
    downloads: 12_000,
    likes: 120,
    tags: ['text-generation', 'chat'],
    siblings: [
      { filename: 'model.Q4_K_M.gguf', sizeBytes: 4_200_000_000 },
      { filename: 'model.Q8_0.gguf', sizeBytes: 9_000_000_000 },
    ],
  }
}

function localHfModel(filename: string): LocalHfModel {
  return {
    id: `org/model#${filename}`,
    provider: 'llamacpp',
    repoId: 'org/model',
    requestedRevision: 'main',
    resolvedRevision: '0123456789abcdef0123456789abcdef01234567',
    filename,
    displayName: `org/model / ${filename}`,
    localPath: `models/${filename}`,
    sizeBytes: filename.includes('Q8') ? 9_000_000_000 : 4_200_000_000,
    format: 'gguf',
    runtime: 'llama.cpp runnable',
    task: 'chat/instruct',
    sizeClass: filename.includes('Q8') ? 'medium' : 'small',
    quantization: filename.includes('Q8') ? 'Q8_0' : 'Q4_K_M',
    risk: 'low',
    credibility: 'established',
    reviewedAt: new Date(0).toISOString(),
    installedAt: new Date(0).toISOString(),
    status: 'ready',
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
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'huggingface-link',
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
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'huggingface-link',
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
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'huggingface-link',
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

  assert.equal(optionByValue(options, 'key:manage:openai').label, 'api key · manage')
  assert.equal(optionByValue(options, 'catalog:openai').label, 'full catalog')
  assert.equal(optionByValue(options, 'catalog:openai').role, 'utility')
  assert.equal(optionByValue(options, 'catalog:openai').indent, 4)
  assert.equal(optionByValue(options, 'key:manage:openai').role, 'utility')
  assert.equal(optionByValue(options, 'key:manage:openai').indent, 4)
  assert.equal(optionByValue(options, 'key:set:anthropic').label, 'api key · add')
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

  assert.equal(optionByValue(options, 'hdr:local').role, 'section')
  assert.equal(optionByValue(options, 'hdr:local').label, 'local models')
  assert.equal(optionByValue(options, 'hdr:local:hf').role, 'group')
  assert.equal(optionByValue(options, 'hf:download').label, 'add local model file')
  assert.equal(optionByValue(options, 'hf:download').hint, 'paste a GGUF link')
  assert.equal(optionByValue(options, 'local:catalog').label, 'view full catalog')
  assert.equal(options.some(option => option.value.startsWith('ol:')), false)
  assert.equal(options.some(option => option.value === 'hdr:local:ollama'), false)
  assert.equal(options.some(option => option.value === 'local:uninstall'), false)
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

test('Hugging Face picker shows installed models and link-only download action', () => {
  const options = buildModelPickerOptions(baseData({
    llamaCpp: {
      binaryPresent: true,
      serverUp: false,
    },
    hfModels: [{
      id: 'org/model#model.Q4_K_M.gguf',
      displayName: 'org/model / model.Q4_K_M.gguf',
      sizeBytes: 4_200_000_000,
      quantization: 'Q4_K_M',
      risk: 'low',
      task: 'chat/instruct',
      status: 'ready',
    }],
  }), {
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'org/model#model.Q4_K_M.gguf',
  })

  assert.equal(optionByValue(options, 'hdr:local:hf').label, 'added from links')
  assert.match(optionByValue(options, 'hf:org/model#model.Q4_K_M.gguf').label, /\* org\/model \/ model\.Q4_K_M\.gguf/)
  assert.doesNotMatch(optionByValue(options, 'hf:org/model#model.Q4_K_M.gguf').label, /4\.2 GB/)
  assert.equal(optionByValue(options, 'hf:org/model#model.Q4_K_M.gguf').prefix, undefined)
  assert.equal(optionByValue(options, 'hf:org/model#model.Q4_K_M.gguf').subtext, '4.2 GB · installed')
  assert.equal(optionByValue(options, 'hf:org/model#model.Q4_K_M.gguf').hint, undefined)
  assert.equal(optionByValue(options, 'hf:download').label, 'add local model file')
  assert.equal(optionByValue(options, 'local:uninstall').label, 'uninstall downloaded GGUF')
  assert.equal(options.some(option => option.value.startsWith('catalog:huggingface')), false)
})

test('Hugging Face file picker renders size and status as muted subtext', () => {
  const repo = hfRepo()
  const options = buildHfFileOptions(repo, repo.siblings, machineSpec(), ['org/model#model.Q4_K_M.gguf'])

  const recommended = optionByValue(options, 'model.Q4_K_M.gguf')
  assert.equal(recommended.label, 'model.Q4_K_M.gguf')
  assert.equal(recommended.subtext, '4.2 GB · recommended · installed')
  assert.equal(recommended.hint, undefined)

  const other = optionByValue(options, 'model.Q8_0.gguf')
  assert.equal(other.label, 'model.Q8_0.gguf')
  assert.equal(other.subtext, '9.0 GB')
  assert.equal(other.hint, undefined)
})

test('installed Hugging Face resolver prefers the installed recommended file', () => {
  const repo = hfRepo()
  const installed = [
    localHfModel('model.Q8_0.gguf'),
    localHfModel('model.Q4_K_M.gguf'),
  ]

  const selected = chooseInstalledHfModelForRepo(installed, repo, repo.siblings, undefined, machineSpec())
  const exact = chooseInstalledHfModelForRepo(installed, repo, repo.siblings, 'model.Q8_0.gguf', machineSpec())

  assert.equal(selected?.filename, 'model.Q4_K_M.gguf')
  assert.equal(exact?.filename, 'model.Q8_0.gguf')
})

test('view full catalog shows one recommendation and installed status', () => {
  const repo = hfRepo()
  const installedEntry = uncensoredCatalogEntry({
    repo,
    installed: true,
  })
  const options = buildLocalModelCatalogOptions(baseData(), {
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'org/model#model.Q4_K_M.gguf',
  }, [installedEntry])

  const option = optionByValue(options, catalogOptionValue(repo.repoId, 'model.Q4_K_M.gguf'))
  assert.equal(optionByValue(options, 'hdr:uncensored:catalog').label, 'hugging face gguf files')
  assert.equal(option.label, 'org/model / model.Q4_K_M.gguf')
  assert.equal(option.subtext, 'Q4_K_M · 4.2 GB · recommended for this machine · installed')
  assert.equal(options.some(candidate => candidate.value.startsWith('ol:')), false)
  assert.equal(options.some(candidate => candidate.value === 'ollama:uninstall'), false)
})

test('Hugging Face picker truncates long installed local model names', () => {
  const id = 'very-long-org-name/very-long-model-name-with-extra-descriptors-GGUF#nested/path/model-name-with-a-long-context-and-quantization-label.Q4_K_M.gguf'
  const options = buildModelPickerOptions(baseData({
    hfModels: [{
      id,
      displayName: 'very-long-org-name/very-long-model-name-with-extra-descriptors-GGUF / model-name-with-a-long-context-and-quantization-label.Q4_K_M.gguf',
      sizeBytes: 4_200_000_000,
      quantization: 'Q4_K_M',
      risk: 'low',
      task: 'chat/instruct',
      status: 'ready',
    }],
  }), {
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'huggingface-link',
  })

  const label = optionByValue(options, `hf:${id}`).label
  assert.ok(label.length < 100)
  assert.match(label, / \/ /)
  assert.match(label, /\.\.\./)
  assert.doesNotMatch(label, /#/)
})

test('empty keyed cloud catalogs show no selectable model rows', () => {
  const options = buildModelPickerOptions(baseData({
    cloudCatalogs: {
      openai: catalog('openai', []),
    },
  }), {
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'huggingface-link',
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
    'llamacpp',
    ['org/qwen3#qwen3.Q4_K_M.gguf', 'org/llama3.1#llama3.1.Q4_K_M.gguf'],
    { usedTokens: 32_000, thresholdPercent: 90 },
  )

  assert.deepEqual(ordered, ['org/llama3.1#llama3.1.Q4_K_M.gguf', 'org/qwen3#qwen3.Q4_K_M.gguf'])
})

test('context fit mode annotates projected usage and prefers larger cloud windows', () => {
  const options = buildModelPickerOptions(baseData({
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
    currentProvider: 'llamacpp' as ProviderId,
    currentModel: 'org/qwen3#qwen3.Q4_K_M.gguf',
    contextFit: { usedTokens: 32_000, thresholdPercent: 90 },
  })

  assert.equal(valuesFor(options, 'openai')[0], 'gpt-4.1')
  assert.match(optionByValue(options, 'c:openai:gpt-4.1').label, /1m ctx 3%/)
  assert.match(optionByValue(options, 'c:anthropic:claude-sonnet-4-5-20250929').label, /200k ctx 16%/)
})
