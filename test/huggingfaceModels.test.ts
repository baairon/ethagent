import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createHfDownloadPlan,
  fetchHuggingFaceRepoInfo,
  fileFormat,
  getLocalHfCacheDir,
  loadLocalHfModels,
  localModelId,
  parseHuggingFaceRef,
  quantizationFromFilename,
  reviewHfModel,
  saveLocalHfModels,
  searchHuggingFaceModels,
  shouldReportDownloadProgress,
  uninstallLocalHfModel,
  type LocalHfModel,
  type HuggingFaceRepoInfo,
} from '../src/models/huggingface.js'
import { recommendGgufFile } from '../src/models/modelRecommendation.js'
import type { SpecSnapshot } from '../src/models/runtimeDetection.js'

const repo: HuggingFaceRepoInfo = {
  repoId: 'org/model-GGUF',
  author: 'org',
  sha: '0123456789abcdef0123456789abcdef01234567',
  license: 'apache-2.0',
  downloads: 12_000,
  likes: 120,
  lastModified: '2026-01-01T00:00:00.000Z',
  tags: ['text-generation', 'license:apache-2.0'],
  siblings: [
    { filename: 'model.Q4_K_M.gguf', sizeBytes: 4_200_000_000 },
    { filename: 'model.safetensors', sizeBytes: 8_000_000_000 },
  ],
}

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-hf-'))
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  try {
    await fn()
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    await fs.rm(dir, { recursive: true, force: true })
  }
}

function localModel(overrides: Partial<LocalHfModel> = {}): LocalHfModel {
  const repoId = overrides.repoId ?? 'org/model-GGUF'
  const filename = overrides.filename ?? 'model.Q4_K_M.gguf'
  const id = overrides.id ?? localModelId(repoId, filename)
  return {
    id,
    provider: 'llamacpp',
    repoId,
    requestedRevision: 'main',
    resolvedRevision: '0123456789abcdef0123456789abcdef01234567',
    filename,
    displayName: 'org/model-GGUF / model.Q4_K_M.gguf',
    localPath: path.join(getLocalHfCacheDir(), 'org', 'model-GGUF', '0123456789abcdef0123456789abcdef01234567', filename),
    sizeBytes: 4_200_000_000,
    format: 'gguf',
    runtime: 'llama.cpp runnable',
    task: 'chat/instruct',
    sizeClass: 'small',
    quantization: 'Q4_K_M',
    risk: 'low',
    credibility: 'established',
    reviewedAt: new Date(0).toISOString(),
    installedAt: new Date(0).toISOString(),
    status: 'ready',
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

test('Hugging Face refs accept repo ids and model file links', () => {
  assert.deepEqual(parseHuggingFaceRef('org/model-GGUF'), {
    repoId: 'org/model-GGUF',
    filename: undefined,
  })
  assert.deepEqual(parseHuggingFaceRef('https://huggingface.co/org/model-GGUF/blob/main/model.Q4_K_M.gguf'), {
    repoId: 'org/model-GGUF',
    revision: 'main',
    filename: 'model.Q4_K_M.gguf',
  })
  assert.deepEqual(parseHuggingFaceRef('org/model-GGUF/model.Q4_K_M.gguf'), {
    repoId: 'org/model-GGUF',
    filename: 'model.Q4_K_M.gguf',
  })
  assert.deepEqual(parseHuggingFaceRef('org/model-GGUF/blob/main/nested/model.Q4_K_M.gguf'), {
    repoId: 'org/model-GGUF',
    filename: 'nested/model.Q4_K_M.gguf',
  })
})

test('GGUF metadata parser extracts format and quantization', () => {
  assert.equal(fileFormat('model.Q4_K_M.gguf'), 'gguf')
  assert.equal(fileFormat('pytorch_model.bin'), 'pickle/bin')
  assert.equal(quantizationFromFilename('model.Q4_K_M.gguf'), 'Q4_K_M')
})

test('repo metadata fetch requests blob details and reads nested LFS sizes', async () => {
  const requestedUrls: URL[] = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(input instanceof URL ? input : new URL(String(input)))
    return new Response(JSON.stringify({
      ...repo,
      siblings: [
        { rfilename: 'model.Q4_K_M.gguf', lfs: { size: 4_200_000_000 } },
        { rfilename: 'README.md', size: 1_024 },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const info = await fetchHuggingFaceRepoInfo({ repoId: 'org/model-GGUF', revision: 'main' }, fetchImpl)
  const requestedUrl = requestedUrls[0]

  assert.ok(requestedUrl)
  assert.equal(requestedUrl.searchParams.get('blobs'), 'true')
  assert.equal(requestedUrl.searchParams.get('revision'), 'main')
  assert.deepEqual(info.siblings, [
    { filename: 'model.Q4_K_M.gguf', sizeBytes: 4_200_000_000 },
    { filename: 'README.md', sizeBytes: 1_024 },
  ])
})

test('Hugging Face model search requests GGUF catalog metadata', async () => {
  const requestedUrls: URL[] = []
  const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
    requestedUrls.push(input instanceof URL ? input : new URL(String(input)))
    return new Response(JSON.stringify([
      {
        id: 'org/uncensored-model-GGUF',
        downloads: 500,
        likes: 20,
        lastModified: '2026-01-02T00:00:00.000Z',
        tags: ['gguf', 'uncensored'],
      },
      { id: 'invalid', tags: ['gguf'] },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  const results = await searchHuggingFaceModels('uncensored', { filter: 'gguf', limit: 12 }, fetchImpl)
  const requestedUrl = requestedUrls[0]

  assert.ok(requestedUrl)
  assert.equal(requestedUrl.searchParams.get('search'), 'uncensored')
  assert.equal(requestedUrl.searchParams.get('filter'), 'gguf')
  assert.equal(requestedUrl.searchParams.get('sort'), 'downloads')
  assert.equal(requestedUrl.searchParams.get('direction'), '-1')
  assert.equal(requestedUrl.searchParams.get('limit'), '12')
  assert.deepEqual(results.map(item => item.repoId), ['org/uncensored-model-GGUF'])
})

test('machine recommendation ranks files from fetched Hugging Face size metadata', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    ...repo,
    siblings: [
      { rfilename: 'model.Q4_K_M.gguf', lfs: { size: 4_200_000_000 } },
      { rfilename: 'model.Q8_0.gguf', lfs: { size: 9_000_000_000 } },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch

  const info = await fetchHuggingFaceRepoInfo({ repoId: 'org/model-GGUF' }, fetchImpl)
  const recommendation = recommendGgufFile(info, info.siblings, machineSpec())

  assert.equal(recommendation?.file.filename, 'model.Q4_K_M.gguf')
  assert.equal(recommendation?.fit, 'fits')
})

test('safety review categorizes credible pinned GGUF as low risk', () => {
  const review = reviewHfModel({
    repo,
    filename: 'model.Q4_K_M.gguf',
    sizeBytes: 4_200_000_000,
    requestedRevision: repo.sha!,
    resolvedRevision: repo.sha!,
  })

  assert.equal(review.risk, 'low')
  assert.equal(review.credibility, 'established')
  assert.equal(review.runtime, 'llama.cpp runnable')
  assert.equal(review.task, 'unknown')
})

test('download plans use repo metadata and do not expose a remote model catalog', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify(repo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch

  const plan = await createHfDownloadPlan('org/model-GGUF', 'model.Q4_K_M.gguf', { fetchImpl })

  assert.equal(plan.repoId, 'org/model-GGUF')
  assert.equal(plan.filename, 'model.Q4_K_M.gguf')
  assert.equal(plan.resolvedRevision, repo.sha)
  assert.equal(plan.review.runtime, 'llama.cpp runnable')
})

test('download progress reporting is throttled for tiny chunks', () => {
  assert.equal(shouldReportDownloadProgress(1024, 0, 1_000, 950), false)
  assert.equal(shouldReportDownloadProgress(1024, 0, 1_051, 950), true)
  assert.equal(shouldReportDownloadProgress(16 * 1024 * 1024, 0, 1_000, 999), true)
})

test('local Hugging Face uninstall deletes model, partial, and metadata', async () => {
  await withTempHome(async () => {
    const model = localModel()
    await fs.mkdir(path.dirname(model.localPath), { recursive: true })
    await fs.writeFile(model.localPath, 'model')
    await fs.writeFile(`${model.localPath}.partial`, 'partial')
    await saveLocalHfModels([model])

    const removed = await uninstallLocalHfModel(model.id)

    assert.equal(removed?.id, model.id)
    await assert.rejects(fs.stat(model.localPath), { code: 'ENOENT' })
    await assert.rejects(fs.stat(`${model.localPath}.partial`), { code: 'ENOENT' })
    assert.deepEqual(await loadLocalHfModels(), [])
  })
})

test('local Hugging Face uninstall removes metadata when the model file is already missing', async () => {
  await withTempHome(async () => {
    const model = localModel()
    await saveLocalHfModels([model])

    await uninstallLocalHfModel(model.id)

    assert.deepEqual(await loadLocalHfModels(), [])
  })
})

test('local Hugging Face uninstall refuses paths outside the cache', async () => {
  await withTempHome(async () => {
    const model = localModel({ localPath: path.join(os.tmpdir(), 'outside-model.gguf') })
    await saveLocalHfModels([model])

    await assert.rejects(
      uninstallLocalHfModel(model.id),
      /outside EthAgent model cache/,
    )
    assert.equal((await loadLocalHfModels()).length, 1)
  })
})

test('local Hugging Face uninstall reports busy files without dropping metadata', async () => {
  await withTempHome(async () => {
    const model = localModel()
    await saveLocalHfModels([model])

    await assert.rejects(
      uninstallLocalHfModel(model.id, {
        unlink: async () => {
          const err = new Error('busy') as NodeJS.ErrnoException
          err.code = 'EBUSY'
          throw err
        },
      }),
      /currently in use/,
    )
    assert.equal((await loadLocalHfModels()).length, 1)
  })
})
