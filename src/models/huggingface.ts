import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getConfigDir, ensureConfigDir } from '../storage/config.js'
import { atomicWriteText } from '../storage/atomicWrite.js'

export type HfFileFormat = 'gguf' | 'safetensors' | 'pickle/bin' | 'unknown'
export type HfRuntime = 'llama.cpp runnable' | 'download-only' | 'unsupported'
export type HfTask = 'chat/instruct' | 'base' | 'code' | 'embedding' | 'vision' | 'unknown'
export type HfSizeClass = 'tiny' | 'small' | 'medium' | 'large'
export type HfRisk = 'low' | 'medium' | 'high'
export type HfCredibility = 'established' | 'normal' | 'low-signal'
export type LocalHfStatus = 'ready' | 'incomplete'

export type HuggingFaceRef = {
  repoId: string
  revision?: string
  filename?: string
}

export type HuggingFaceSibling = {
  filename: string
  sizeBytes?: number
}

export type HuggingFaceRepoInfo = {
  repoId: string
  author?: string
  sha?: string
  license?: string
  downloads?: number
  likes?: number
  lastModified?: string
  tags: string[]
  siblings: HuggingFaceSibling[]
}

export type HfSafetyReview = {
  risk: HfRisk
  credibility: HfCredibility
  format: HfFileFormat
  runtime: HfRuntime
  task: HfTask
  sizeClass: HfSizeClass
  quantization?: string
  reasons: string[]
}

export type HfDownloadPlan = {
  repo: HuggingFaceRepoInfo
  repoId: string
  requestedRevision: string
  resolvedRevision: string
  filename: string
  sizeBytes: number
  localPath: string
  displayName: string
  review: HfSafetyReview
}

export type LocalHfModel = {
  id: string
  provider: 'llamacpp'
  repoId: string
  requestedRevision: string
  resolvedRevision: string
  filename: string
  displayName: string
  localPath: string
  sizeBytes: number
  format: HfFileFormat
  runtime: HfRuntime
  task: HfTask
  sizeClass: HfSizeClass
  quantization?: string
  risk: HfRisk
  credibility: HfCredibility
  license?: string
  downloads?: number
  likes?: number
  reviewedAt: string
  installedAt: string
  status: LocalHfStatus
  sha256?: string
}

export type HfDownloadProgress = {
  status: string
  completed?: number
  total?: number
}

type FetchImpl = typeof fetch
type UninstallDeps = {
  unlink?: (target: string) => Promise<void>
  rmdir?: (target: string) => Promise<void>
}

type ModelInfoResponse = {
  id?: unknown
  author?: unknown
  sha?: unknown
  downloads?: unknown
  likes?: unknown
  lastModified?: unknown
  tags?: unknown
  cardData?: unknown
  siblings?: unknown
}

const HF_BASE_URL = 'https://huggingface.co'
const DEFAULT_REVISION = 'main'
const COMMIT_RE = /^[a-f0-9]{40}$/i
const DOWNLOAD_PROGRESS_MIN_MS = 100
const DOWNLOAD_PROGRESS_MIN_BYTES = 16 * 1024 * 1024

export function getLocalHfModelsPath(): string {
  return path.join(getConfigDir(), 'local-models.json')
}

export function getLocalHfCacheDir(): string {
  return path.join(getConfigDir(), 'models', 'huggingface')
}

export async function loadLocalHfModels(): Promise<LocalHfModel[]> {
  try {
    const raw = await fs.readFile(getLocalHfModelsPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLocalHfModel)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    return []
  }
}

export async function saveLocalHfModels(models: LocalHfModel[]): Promise<void> {
  await ensureConfigDir()
  await atomicWriteText(getLocalHfModelsPath(), JSON.stringify(models, null, 2) + '\n')
}

export async function upsertLocalHfModel(model: LocalHfModel): Promise<void> {
  const current = await loadLocalHfModels()
  const next = [
    model,
    ...current.filter(existing => existing.id !== model.id),
  ]
  await saveLocalHfModels(next)
}

export async function findLocalHfModel(id: string): Promise<LocalHfModel | null> {
  const models = await loadLocalHfModels()
  return models.find(model => model.id === id) ?? null
}

export async function uninstallLocalHfModel(
  id: string,
  deps: UninstallDeps = {},
): Promise<LocalHfModel | null> {
  const models = await loadLocalHfModels()
  const model = models.find(item => item.id === id)
  if (!model) return null

  const cacheRoot = path.resolve(getLocalHfCacheDir())
  const modelPath = path.resolve(model.localPath)
  const partialPath = path.resolve(`${model.localPath}.partial`)
  if (!isPathInside(cacheRoot, modelPath) || !isPathInside(cacheRoot, partialPath)) {
    throw new Error('refusing to uninstall a local model outside EthAgent model cache')
  }

  const unlink = deps.unlink ?? ((target: string) => fs.unlink(target))
  const rmdir = deps.rmdir ?? ((target: string) => fs.rmdir(target))
  await unlinkIfPresent(modelPath, unlink)
  await unlinkIfPresent(partialPath, unlink)
  await cleanupEmptyParents(path.dirname(modelPath), cacheRoot, rmdir)

  await saveLocalHfModels(models.filter(item => item.id !== id))
  return model
}

export function parseHuggingFaceRef(input: string): HuggingFaceRef {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Hugging Face model link or repo id is required')

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const host = url.hostname.toLowerCase()
    if (host !== 'huggingface.co' && host !== 'www.huggingface.co') {
      throw new Error('expected a huggingface.co model link')
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) throw new Error('expected a Hugging Face repo link')
    const repoId = `${decodeURIComponent(parts[0]!)}/${decodeURIComponent(parts[1]!)}`
    const mode = parts[2]
    if (mode === 'blob' || mode === 'resolve' || mode === 'tree') {
      const revision = parts[3] ? decodeURIComponent(parts[3]) : undefined
      const filename = parts.length > 4
        ? parts.slice(4).map(part => decodeURIComponent(part)).join('/')
        : undefined
      return { repoId, revision, filename }
    }
    return { repoId }
  }

  const withoutPrefix = trimmed.replace(/^hf:\/\//i, '')
  const parts = withoutPrefix.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('expected repo id like org/model or a huggingface.co link')
  const repoId = `${parts[0]!}/${parts[1]!}`
  let fileParts = parts.slice(2)
  const mode = fileParts[0]
  if ((mode === 'blob' || mode === 'resolve' || mode === 'tree') && fileParts.length >= 2) {
    fileParts = fileParts.slice(2)
  }
  const filename = fileParts.length > 0 ? fileParts.join('/') : undefined
  return { repoId, filename }
}

export async function fetchHuggingFaceRepoInfo(
  ref: HuggingFaceRef,
  fetchImpl: FetchImpl = fetch,
): Promise<HuggingFaceRepoInfo> {
  const url = new URL(`${HF_BASE_URL}/api/models/${encodeRepoPath(ref.repoId)}`)
  if (ref.revision) url.searchParams.set('revision', ref.revision)
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('repo is gated or private')
    }
    if (response.status === 404) throw new Error('Hugging Face repo not found')
    throw new Error(`Hugging Face API HTTP ${response.status}`)
  }
  const data = await response.json() as ModelInfoResponse
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === 'string')
    : []
  const siblings = Array.isArray(data.siblings)
    ? data.siblings.flatMap(sibling => parseSibling(sibling))
    : []
  return {
    repoId: typeof data.id === 'string' ? data.id : ref.repoId,
    author: typeof data.author === 'string' ? data.author : undefined,
    sha: typeof data.sha === 'string' ? data.sha : undefined,
    license: licenseFrom(data.cardData, tags),
    downloads: typeof data.downloads === 'number' ? data.downloads : undefined,
    likes: typeof data.likes === 'number' ? data.likes : undefined,
    lastModified: typeof data.lastModified === 'string' ? data.lastModified : undefined,
    tags,
    siblings,
  }
}

export function ggufFiles(repo: HuggingFaceRepoInfo): HuggingFaceSibling[] {
  return repo.siblings
    .filter(file => file.filename.toLowerCase().endsWith('.gguf'))
    .sort((a, b) => a.filename.localeCompare(b.filename))
}

export async function createHfDownloadPlan(
  input: string,
  filename?: string,
  deps: { fetchImpl?: FetchImpl; now?: () => Date } = {},
): Promise<HfDownloadPlan> {
  const ref = parseHuggingFaceRef(input)
  const selectedFilename = filename?.trim() || ref.filename
  const repo = await fetchHuggingFaceRepoInfo(ref, deps.fetchImpl)
  const files = ggufFiles(repo)
  if (files.length === 0) {
    throw new Error('no compatible local model files found for this link')
  }
  const selected = selectedFilename
    ? files.find(file => file.filename === selectedFilename)
    : files[0]
  if (!selected) {
    throw new Error(`compatible file not found: ${selectedFilename}`)
  }

  const requestedRevision = ref.revision ?? DEFAULT_REVISION
  const resolvedRevision = repo.sha || requestedRevision
  const sizeBytes = selected.sizeBytes ?? 0
  const review = reviewHfModel({
    repo,
    filename: selected.filename,
    sizeBytes,
    requestedRevision,
    resolvedRevision,
  })
  return {
    repo,
    repoId: repo.repoId,
    requestedRevision,
    resolvedRevision,
    filename: selected.filename,
    sizeBytes,
    localPath: localPathFor(repo.repoId, resolvedRevision, selected.filename),
    displayName: displayNameFor(repo.repoId, selected.filename),
    review,
  }
}

export function reviewHfModel(args: {
  repo: HuggingFaceRepoInfo
  filename: string
  sizeBytes: number
  requestedRevision: string
  resolvedRevision: string
}): HfSafetyReview {
  const format = fileFormat(args.filename)
  const runtime: HfRuntime =
    format === 'gguf' ? 'llama.cpp runnable'
      : format === 'safetensors' ? 'download-only'
        : 'unsupported'
  const quantization = quantizationFromFilename(args.filename)
  const task = taskFor(args.repo, args.filename)
  const sizeClass = sizeClassFor(args.sizeBytes)
  const credibility = credibilityFor(args.repo)
  const pinned = COMMIT_RE.test(args.requestedRevision) || COMMIT_RE.test(args.resolvedRevision)
  const repoHasRiskyFiles = args.repo.siblings.some(file => fileFormat(file.filename) === 'pickle/bin')
  const reasons: string[] = []

  if (format !== 'gguf') reasons.push('selected file is not compatible with local chat')
  if (!pinned) reasons.push('revision is mutable')
  if (!args.repo.license) reasons.push('license is missing or unknown')
  if (credibility === 'low-signal') reasons.push('repo has limited public usage signals')
  if (repoHasRiskyFiles) reasons.push('repo also contains pickle/bin model files')

  const risk: HfRisk =
    format !== 'gguf'
      ? 'high'
      : repoHasRiskyFiles
        ? 'medium'
        : pinned && args.repo.license && credibility !== 'low-signal'
          ? 'low'
          : 'medium'

  if (reasons.length === 0) reasons.push('compatible local model file with usable repo metadata')

  return {
    risk,
    credibility,
    format,
    runtime,
    task,
    sizeClass,
    quantization,
    reasons,
  }
}

export async function* downloadHfModel(
  plan: HfDownloadPlan,
  signal?: AbortSignal,
  fetchImpl: FetchImpl = fetch,
): AsyncIterable<HfDownloadProgress> {
  if (plan.review.runtime !== 'llama.cpp runnable') {
    throw new Error('selected file is not compatible with local chat')
  }

  await fs.mkdir(path.dirname(plan.localPath), { recursive: true })
  const partialPath = `${plan.localPath}.partial`
  const response = await fetchImpl(resolveUrl(plan.repoId, plan.resolvedRevision, plan.filename), { signal })
  if (!response.ok || !response.body) {
    throw new Error(response.ok ? 'empty download body' : `download HTTP ${response.status}`)
  }

  const total = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const hash = createHash('sha256')
  const handle = await fs.open(partialPath, 'w')
  let completed = 0
  let complete = false
  let lastProgressAt = Date.now()
  let lastProgressBytes = 0
  yield { status: 'starting', completed, total: Number.isFinite(total) ? total : undefined }
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal?.aborted) throw new Error('cancelled')
      const buffer = Buffer.from(value)
      hash.update(buffer)
      await handle.write(buffer)
      completed += buffer.byteLength
      const now = Date.now()
      if (shouldReportDownloadProgress(completed, lastProgressBytes, now, lastProgressAt)) {
        lastProgressAt = now
        lastProgressBytes = completed
        yield { status: 'downloading', completed, total: Number.isFinite(total) ? total : undefined }
      }
    }
    complete = true
  } finally {
    await handle.close()
    if (!complete) {
      await fs.unlink(partialPath).catch(() => {})
    }
  }

  await fs.rename(partialPath, plan.localPath)
  await upsertLocalHfModel(modelFromPlan(plan, hash.digest('hex'), 'ready'))
  yield { status: 'success', completed, total: Number.isFinite(total) ? total : completed }
}

export function shouldReportDownloadProgress(
  completed: number,
  lastCompleted: number,
  nowMs: number,
  lastReportedMs: number,
): boolean {
  return nowMs - lastReportedMs >= DOWNLOAD_PROGRESS_MIN_MS
    || completed - lastCompleted >= DOWNLOAD_PROGRESS_MIN_BYTES
}

export function modelFromPlan(plan: HfDownloadPlan, sha256: string | undefined, status: LocalHfStatus): LocalHfModel {
  const now = new Date().toISOString()
  return {
    id: localModelId(plan.repoId, plan.filename),
    provider: 'llamacpp',
    repoId: plan.repoId,
    requestedRevision: plan.requestedRevision,
    resolvedRevision: plan.resolvedRevision,
    filename: plan.filename,
    displayName: plan.displayName,
    localPath: plan.localPath,
    sizeBytes: plan.sizeBytes,
    format: plan.review.format,
    runtime: plan.review.runtime,
    task: plan.review.task,
    sizeClass: plan.review.sizeClass,
    quantization: plan.review.quantization,
    risk: plan.review.risk,
    credibility: plan.review.credibility,
    license: plan.repo.license,
    downloads: plan.repo.downloads,
    likes: plan.repo.likes,
    reviewedAt: now,
    installedAt: now,
    status,
    sha256,
  }
}

export function localModelId(repoId: string, filename: string): string {
  return `${repoId}#${filename}`
}

export function displayNameFor(repoId: string, filename: string): string {
  const basename = filename.split('/').pop() ?? filename
  return `${repoId} / ${basename}`
}

export function fileFormat(filename: string): HfFileFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.gguf')) return 'gguf'
  if (lower.endsWith('.safetensors')) return 'safetensors'
  if (/\.(bin|pt|pth|pkl|pickle)$/.test(lower)) return 'pickle/bin'
  return 'unknown'
}

export function quantizationFromFilename(filename: string): string | undefined {
  const match = filename.toUpperCase().match(/(?:^|[-_.])((?:IQ|Q)\d(?:_[A-Z0-9]+)*|F16|BF16|F32)(?=$|[-_.])/)
  return match?.[1]
}

function localPathFor(repoId: string, revision: string, filename: string): string {
  const repoParts = repoId.split('/').map(safePathPart)
  const fileParts = filename.split('/').map(safePathPart)
  return path.join(getLocalHfCacheDir(), ...repoParts, safePathPart(revision), ...fileParts)
}

async function unlinkIfPresent(
  target: string,
  unlink: (target: string) => Promise<void>,
): Promise<void> {
  try {
    await unlink(target)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
      throw new Error('that model file is currently in use. stop the local runner and try uninstall again.')
    }
    throw err
  }
}

async function cleanupEmptyParents(
  startDir: string,
  cacheRoot: string,
  rmdir: (target: string) => Promise<void>,
): Promise<void> {
  let current = path.resolve(startDir)
  while (isPathInside(cacheRoot, current) && current !== cacheRoot) {
    try {
      await rmdir(current)
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        current = path.dirname(current)
        continue
      }
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM') return
      throw err
    }
    current = path.dirname(current)
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function resolveUrl(repoId: string, revision: string, filename: string): string {
  return `${HF_BASE_URL}/${encodeRepoPath(repoId)}/resolve/${encodeURIComponent(revision)}/${encodePath(filename)}?download=true`
}

function encodeRepoPath(repoId: string): string {
  return repoId.split('/').map(part => encodeURIComponent(part)).join('/')
}

function encodePath(value: string): string {
  return value.split('/').map(part => encodeURIComponent(part)).join('/')
}

function safePathPart(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
  return cleaned || '_'
}

function parseSibling(value: unknown): HuggingFaceSibling[] {
  if (!value || typeof value !== 'object') return []
  const record = value as { rfilename?: unknown; filename?: unknown; size?: unknown }
  const filename = typeof record.rfilename === 'string'
    ? record.rfilename
    : typeof record.filename === 'string' ? record.filename : ''
  if (!filename) return []
  return [{
    filename,
    sizeBytes: typeof record.size === 'number' ? record.size : undefined,
  }]
}

function licenseFrom(cardData: unknown, tags: string[]): string | undefined {
  if (cardData && typeof cardData === 'object' && !Array.isArray(cardData)) {
    const license = (cardData as { license?: unknown }).license
    if (typeof license === 'string' && license.trim()) return license.trim()
  }
  const tag = tags.find(item => item.startsWith('license:'))
  return tag ? tag.slice('license:'.length) : undefined
}

function credibilityFor(repo: HuggingFaceRepoInfo): HfCredibility {
  const downloads = repo.downloads ?? 0
  const likes = repo.likes ?? 0
  if (downloads >= 10_000 || likes >= 100) return 'established'
  if (downloads >= 100 || likes >= 5 || Boolean(repo.license)) return 'normal'
  return 'low-signal'
}

function taskFor(repo: HuggingFaceRepoInfo, filename: string): HfTask {
  const haystack = [repo.repoId, filename, ...repo.tags].join(' ').toLowerCase()
  if (/(embed|embedding)/.test(haystack)) return 'embedding'
  if (/(vision|vlm|multimodal)/.test(haystack)) return 'vision'
  if (/(code|coder|coding)/.test(haystack)) return 'code'
  if (/(chat|instruct|assistant)/.test(haystack)) return 'chat/instruct'
  if (/(base)/.test(haystack)) return 'base'
  return 'unknown'
}

function sizeClassFor(sizeBytes: number): HfSizeClass {
  const gb = sizeBytes / 1e9
  if (gb < 2) return 'tiny'
  if (gb < 8) return 'small'
  if (gb < 24) return 'medium'
  return 'large'
}

function isLocalHfModel(value: unknown): value is LocalHfModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<LocalHfModel>
  return item.provider === 'llamacpp'
    && typeof item.id === 'string'
    && typeof item.repoId === 'string'
    && typeof item.filename === 'string'
    && typeof item.displayName === 'string'
    && typeof item.localPath === 'string'
    && item.status === 'ready'
}
