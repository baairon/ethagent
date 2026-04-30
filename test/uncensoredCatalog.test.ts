import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchUncensoredGgufCatalog } from '../src/models/uncensoredCatalog.js'
import { FEATURED_HF_REPO } from '../src/models/modelRecommendation.js'
import type { LocalHfModel } from '../src/models/huggingface.js'
import type { SpecSnapshot } from '../src/models/runtimeDetection.js'

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

function installedModel(overrides: Partial<LocalHfModel> = {}): LocalHfModel {
  return {
    id: `${FEATURED_HF_REPO}#Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf`,
    provider: 'llamacpp',
    repoId: FEATURED_HF_REPO,
    requestedRevision: 'main',
    resolvedRevision: '0123456789abcdef0123456789abcdef01234567',
    filename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf',
    displayName: `${FEATURED_HF_REPO} / Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf`,
    localPath: 'models/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf',
    sizeBytes: 8_900_000_000,
    format: 'gguf',
    runtime: 'llama.cpp runnable',
    task: 'chat/instruct',
    sizeClass: 'medium',
    quantization: 'Q8_0',
    risk: 'low',
    credibility: 'established',
    reviewedAt: new Date(0).toISOString(),
    installedAt: new Date(0).toISOString(),
    status: 'ready',
    ...overrides,
  }
}

test('view full catalog only includes configured repo and marks one recommendation', async () => {
  const requestedUrls: URL[] = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    const url = input instanceof URL ? input : new URL(String(input))
    requestedUrls.push(url)
    const repoId = decodeURIComponent(url.pathname.replace(/^\/api\/models\//, ''))
    if (repoId === FEATURED_HF_REPO) {
      return repoResponse(FEATURED_HF_REPO, [
        { rfilename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf', lfs: { size: 17_000_000_000 } },
        { rfilename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf', lfs: { size: 8_900_000_000 } },
        { rfilename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf', lfs: { size: 6_900_000_000 } },
        { rfilename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf', lfs: { size: 5_300_000_000 } },
        { rfilename: 'mmproj-Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf', lfs: { size: 880_000_000 } },
      ])
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  const catalog = await fetchUncensoredGgufCatalog({
    machineSpec: machineSpec(),
    installedModels: [installedModel()],
    fetchImpl,
    limit: 5,
  })

  assert.equal(requestedUrls.some(url => url.pathname === '/api/models'), false)
  assert.equal(catalog.length, 5)
  assert.ok(catalog.every(entry => entry.repo.repoId === FEATURED_HF_REPO))
  assert.deepEqual(catalog.map(entry => entry.file.filename), [
    'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf',
    'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf',
    'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf',
    'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf',
    'mmproj-Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf',
  ])
  assert.equal(catalog.filter(entry => entry.recommended).length, 1)
  const installed = catalog.find(entry => entry.file.filename.endsWith('Q8_0.gguf'))
  assert.equal(installed?.installed, true)
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function repoResponse(repoId: string, siblings: unknown[]): Response {
  return jsonResponse({
    id: repoId,
    sha: '0123456789abcdef0123456789abcdef01234567',
    tags: ['gguf', 'uncensored', 'chat'],
    downloads: 10_000,
    likes: 100,
    cardData: { license: 'apache-2.0' },
    siblings,
  })
}
