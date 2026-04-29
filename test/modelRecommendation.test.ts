import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateGgufMachineFit,
  recommendGgufFile,
} from '../src/bootstrap/modelRecommendation.js'
import type { HuggingFaceRepoInfo } from '../src/models/huggingface.js'
import type { SpecSnapshot } from '../src/bootstrap/runtimeDetection.js'

function spec(overrides: Partial<SpecSnapshot> = {}): SpecSnapshot {
  return {
    platform: 'linux',
    arch: 'x64',
    cpuCores: 8,
    totalRamBytes: 16 * 1024 * 1024 * 1024,
    effectiveRamBytes: 16 * 1024 * 1024 * 1024,
    isAppleSilicon: false,
    gpuVramBytes: null,
    hasOllama: false,
    ollamaVersion: null,
    ollamaDaemonUp: false,
    installedModels: [],
    ...overrides,
  }
}

function repo(files: HuggingFaceRepoInfo['siblings']): HuggingFaceRepoInfo {
  return {
    repoId: 'org/chat-model-GGUF',
    author: 'org',
    sha: '0123456789abcdef0123456789abcdef01234567',
    license: 'apache-2.0',
    downloads: 10_000,
    likes: 100,
    tags: ['text-generation', 'chat', 'instruct'],
    siblings: files,
  }
}

test('GGUF recommendation prefers the balanced file that fits modest RAM', () => {
  const info = repo([
    { filename: 'model.Q4_K_M.gguf', sizeBytes: 4_200_000_000 },
    { filename: 'model.Q5_K_M.gguf', sizeBytes: 5_400_000_000 },
    { filename: 'model.Q8_0.gguf', sizeBytes: 9_000_000_000 },
  ])

  const recommendation = recommendGgufFile(info, info.siblings, spec({
    totalRamBytes: 12 * 1024 * 1024 * 1024,
    effectiveRamBytes: 12 * 1024 * 1024 * 1024,
  }))

  assert.equal(recommendation?.file.filename, 'model.Q4_K_M.gguf')
  assert.equal(recommendation?.fit, 'fits')
})

test('GGUF recommendation uses larger quantization on high VRAM machines', () => {
  const info = repo([
    { filename: 'model.Q4_K_M.gguf', sizeBytes: 4_200_000_000 },
    { filename: 'model.Q5_K_M.gguf', sizeBytes: 5_400_000_000 },
    { filename: 'model.Q8_0.gguf', sizeBytes: 9_000_000_000 },
  ])

  const recommendation = recommendGgufFile(info, info.siblings, spec({
    gpuVramBytes: 24 * 1024 * 1024 * 1024,
  }))

  assert.equal(recommendation?.file.filename, 'model.Q8_0.gguf')
  assert.equal(recommendation?.fit, 'fits')
})

test('GGUF recommendation avoids embedding files when chat files fit', () => {
  const info = repo([
    { filename: 'model-embedding.Q4_K_M.gguf', sizeBytes: 3_000_000_000 },
    { filename: 'model-instruct.Q4_K_M.gguf', sizeBytes: 3_200_000_000 },
  ])

  const recommendation = recommendGgufFile(info, info.siblings, spec())

  assert.equal(recommendation?.file.filename, 'model-instruct.Q4_K_M.gguf')
})

test('GGUF machine fit handles missing sizes and too-large files', () => {
  assert.equal(estimateGgufMachineFit(undefined, spec()).fit, 'unknown')
  assert.equal(estimateGgufMachineFit(100_000_000_000, spec()).fit, 'too-large')
})
