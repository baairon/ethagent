import {
  fetchHuggingFaceRepoInfo,
  ggufFiles,
  localModelId,
  type HuggingFaceRepoInfo,
  type HuggingFaceSibling,
  type LocalHfModel,
} from './huggingface.js'
import {
  FEATURED_HF_REPO,
  estimateGgufMachineFit,
  recommendGgufFile,
  type GgufMachineFit,
} from './modelRecommendation.js'
import type { SpecSnapshot } from './runtimeDetection.js'

export type UncensoredCatalogEntry = {
  repo: HuggingFaceRepoInfo
  file: HuggingFaceSibling
  fit: GgufMachineFit
  recommended: boolean
  installed: boolean
}

type FetchImpl = typeof fetch

const GB = 1024 * 1024 * 1024
const FEATURED_FILE_ORDER = [
  { filename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf', fallbackSizeBytes: Math.round(17 * GB) },
  { filename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q8_0.gguf', fallbackSizeBytes: Math.round(8.9 * GB) },
  { filename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf', fallbackSizeBytes: Math.round(6.9 * GB) },
  { filename: 'Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf', fallbackSizeBytes: Math.round(5.3 * GB) },
  { filename: 'mmproj-Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16.gguf', fallbackSizeBytes: Math.round(0.88 * GB) },
] as const

export async function fetchUncensoredGgufCatalog(args: {
  machineSpec?: SpecSnapshot
  installedModels: LocalHfModel[]
  fetchImpl?: FetchImpl
  limit?: number
}): Promise<UncensoredCatalogEntry[]> {
  const fetchImpl = args.fetchImpl ?? fetch
  const repos = await Promise.allSettled([
    fetchHuggingFaceRepoInfo({ repoId: FEATURED_HF_REPO }, fetchImpl),
  ])
  const installed = new Set(args.installedModels.filter(model => model.status === 'ready').map(model => model.id))
  const entries: UncensoredCatalogEntry[] = []

  for (const result of repos) {
    if (result.status !== 'fulfilled') continue
    const repo = result.value
    if (repo.repoId !== FEATURED_HF_REPO) continue
    const files = pickFeaturedFiles(repo)
    if (files.length === 0) continue
    const runnable = files.filter(file => !isVisionEncoder(file.filename))
    const recommendedFilename = args.machineSpec
      ? recommendGgufFile(repo, runnable, args.machineSpec)?.file.filename
      : undefined
    for (const file of files.slice(0, args.limit ?? FEATURED_FILE_ORDER.length)) {
      const recommended = recommendedFilename === file.filename
      entries.push({
        repo,
        file,
        fit: args.machineSpec ? estimateGgufMachineFit(file.sizeBytes, args.machineSpec).fit : 'unknown',
        recommended,
        installed: installed.has(localModelId(repo.repoId, file.filename)),
      })
    }
  }

  return entries
}

function pickFeaturedFiles(repo: HuggingFaceRepoInfo): HuggingFaceSibling[] {
  const byName = new Map(ggufFiles(repo).map(file => [file.filename, file] as const))
  return FEATURED_FILE_ORDER
    .map(spec => {
      const file = byName.get(spec.filename)
      if (file) return file
      return { filename: spec.filename, sizeBytes: spec.fallbackSizeBytes } satisfies HuggingFaceSibling
    })
}

function isVisionEncoder(filename: string): boolean {
  return filename.toLowerCase().startsWith('mmproj-')
}
