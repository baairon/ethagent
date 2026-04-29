import {
  fileFormat,
  quantizationFromFilename,
  type HuggingFaceRepoInfo,
  type HuggingFaceSibling,
} from '../models/huggingface.js'
import type { SpecSnapshot } from './runtimeDetection.js'

const GB = 1024 * 1024 * 1024

export type QwenVariant = {
  model: string
  approxDownloadGB: number
  label: string
  memoryFloorBytes: number
}

export type GgufMachineFit = 'fits' | 'tight' | 'too-large' | 'unknown'

export type GgufFileRecommendation = {
  file: HuggingFaceSibling
  fit: GgufMachineFit
  score: number
  budgetBytes: number
  estimatedRequiredBytes?: number
}

export const qwenLadder: QwenVariant[] = [
  { model: 'qwen2.5-coder:1.5b', approxDownloadGB: 1, label: '1.5B', memoryFloorBytes: 0 },
  { model: 'qwen2.5-coder:3b',   approxDownloadGB: 2, label: '3B',   memoryFloorBytes: 4 * GB },
  { model: 'qwen2.5-coder:7b',   approxDownloadGB: 5, label: '7B',   memoryFloorBytes: 8 * GB },
  { model: 'qwen2.5-coder:14b',  approxDownloadGB: 9, label: '14B',  memoryFloorBytes: 16 * GB },
  { model: 'qwen2.5-coder:32b',  approxDownloadGB: 20, label: '32B', memoryFloorBytes: 32 * GB },
]

export function recommendModel(spec: SpecSnapshot): QwenVariant {
  const smallest = qwenLadder[0]!
  const largest = qwenLadder[qwenLadder.length - 1]!
  const vramFloor = 24 * GB
  if (spec.gpuVramBytes !== null && spec.gpuVramBytes >= vramFloor) {
    return largest
  }
  const budget = spec.gpuVramBytes !== null
    ? Math.max(spec.gpuVramBytes, spec.effectiveRamBytes)
    : spec.effectiveRamBytes

  let chosen: QwenVariant = smallest
  for (const variant of qwenLadder) {
    if (budget >= variant.memoryFloorBytes) chosen = variant
  }
  return chosen
}

export function recommendGgufFile(
  repo: HuggingFaceRepoInfo,
  files: HuggingFaceSibling[],
  spec: SpecSnapshot,
): GgufFileRecommendation | null {
  return orderGgufFilesForSpec(repo, files, spec)[0] ?? null
}

export function orderGgufFilesForSpec(
  repo: HuggingFaceRepoInfo,
  files: HuggingFaceSibling[],
  spec: SpecSnapshot,
): GgufFileRecommendation[] {
  return files
    .filter(file => fileFormat(file.filename) === 'gguf')
    .map(file => scoreGgufFile(repo, file, spec))
    .sort((a, b) =>
      b.score - a.score
      || fitRank(b.fit) - fitRank(a.fit)
      || (a.file.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (b.file.sizeBytes ?? Number.MAX_SAFE_INTEGER)
      || a.file.filename.localeCompare(b.file.filename),
    )
}

export function estimateGgufMachineFit(sizeBytes: number | undefined, spec: SpecSnapshot): {
  fit: GgufMachineFit
  budgetBytes: number
  estimatedRequiredBytes?: number
} {
  const budgetBytes = ggufBudgetBytes(spec)
  if (!sizeBytes || sizeBytes <= 0) return { fit: 'unknown', budgetBytes }
  const estimatedRequiredBytes = Math.ceil(sizeBytes * 1.25 + GB)
  if (estimatedRequiredBytes <= budgetBytes) return { fit: 'fits', budgetBytes, estimatedRequiredBytes }
  if (estimatedRequiredBytes <= budgetBytes * 1.15) return { fit: 'tight', budgetBytes, estimatedRequiredBytes }
  return { fit: 'too-large', budgetBytes, estimatedRequiredBytes }
}

function scoreGgufFile(
  repo: HuggingFaceRepoInfo,
  file: HuggingFaceSibling,
  spec: SpecSnapshot,
): GgufFileRecommendation {
  const fit = estimateGgufMachineFit(file.sizeBytes, spec)
  const lower = `${repo.repoId} ${file.filename} ${repo.tags.join(' ')}`.toLowerCase()
  const score =
    fitScore(fit.fit)
    + taskScore(lower)
    + quantizationScore(quantizationFromFilename(file.filename))
    + sizeScore(file.sizeBytes, fit.fit)

  return {
    file,
    fit: fit.fit,
    budgetBytes: fit.budgetBytes,
    estimatedRequiredBytes: fit.estimatedRequiredBytes,
    score,
  }
}

function ggufBudgetBytes(spec: SpecSnapshot): number {
  if (spec.isAppleSilicon) return Math.floor(spec.effectiveRamBytes * 0.7)
  const cpuBudget = Math.floor(spec.effectiveRamBytes * 0.55)
  if (spec.gpuVramBytes !== null && spec.gpuVramBytes >= 8 * GB) {
    return Math.max(cpuBudget, Math.floor(spec.gpuVramBytes * 0.85))
  }
  return cpuBudget
}

function fitScore(fit: GgufMachineFit): number {
  switch (fit) {
    case 'fits': return 1000
    case 'tight': return 600
    case 'unknown': return 250
    case 'too-large': return -1000
  }
}

function fitRank(fit: GgufMachineFit): number {
  switch (fit) {
    case 'fits': return 3
    case 'tight': return 2
    case 'unknown': return 1
    case 'too-large': return 0
  }
}

function taskScore(text: string): number {
  if (/(embed|embedding|rerank)/.test(text)) return -350
  if (/(vision|vlm|multimodal)/.test(text)) return -250
  if (/(instruct|chat|assistant)/.test(text)) return 250
  if (/(code|coder|coding)/.test(text)) return 120
  if (/(^|[-_\s])base($|[-_\s])/.test(text)) return -100
  return 0
}

function quantizationScore(quantization: string | undefined): number {
  if (!quantization) return 0
  if (quantization === 'Q8_0') return 210
  if (quantization === 'Q6_K') return 195
  if (quantization === 'Q5_K_M') return 185
  if (quantization === 'Q5_K_S') return 175
  if (quantization.startsWith('Q5')) return 165
  if (quantization === 'Q4_K_M') return 155
  if (quantization === 'Q4_K_S') return 140
  if (quantization.startsWith('Q4')) return 125
  if (quantization.startsWith('IQ4')) return 115
  if (quantization.startsWith('IQ3') || quantization.startsWith('Q3')) return 85
  if (quantization === 'F16' || quantization === 'BF16') return 150
  if (quantization === 'F32') return 90
  return 50
}

function sizeScore(sizeBytes: number | undefined, fit: GgufMachineFit): number {
  if (!sizeBytes || fit === 'too-large') return 0
  return Math.min(sizeBytes / GB, 20) * 4
}
