import type { SpecSnapshot } from './detectSpec.js'

const GB = 1024 * 1024 * 1024

export type QwenVariant = {
  model: string
  approxDownloadGB: number
  label: string
  memoryFloorBytes: number
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
