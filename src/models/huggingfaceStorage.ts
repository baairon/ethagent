import fs from 'node:fs/promises'
import path from 'node:path'
import { getConfigDir, ensureConfigDir } from '../storage/config.js'
import { atomicWriteText } from '../storage/atomicWrite.js'
import type { LocalHfModel } from './huggingface.js'

type UninstallDeps = {
  unlink?: (target: string) => Promise<void>
  rmdir?: (target: string) => Promise<void>
}

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
    throw new Error('Refusing to uninstall a local model outside EthAgent model cache')
  }

  const unlink = deps.unlink ?? ((target: string) => fs.unlink(target))
  const rmdir = deps.rmdir ?? ((target: string) => fs.rmdir(target))
  await unlinkIfPresent(modelPath, unlink)
  await unlinkIfPresent(partialPath, unlink)
  await cleanupEmptyParents(path.dirname(modelPath), cacheRoot, rmdir)

  await saveLocalHfModels(models.filter(item => item.id !== id))
  return model
}

export function localPathFor(repoId: string, revision: string, filename: string): string {
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
      throw new Error('That model file is currently in use. Stop the local runner and try uninstall again.')
    }
    throw err
  }
}

async function cleanupEmptyParents(
  startDir: string,
  cacheRoot: string,
  rmdir: (target: string) => Promise<void>,
): Promise<void> {
  let current = startDir
  while (isPathInside(cacheRoot, current) && current !== cacheRoot) {
    try {
      await rmdir(current)
      current = path.dirname(current)
    } catch {
      return
    }
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safePathPart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'unknown'
}

function isLocalHfModel(value: unknown): value is LocalHfModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<LocalHfModel>
  return item.provider === 'llamacpp'
    && typeof item.id === 'string'
    && typeof item.repoId === 'string'
    && typeof item.filename === 'string'
    && typeof item.localPath === 'string'
    && typeof item.sizeBytes === 'number'
    && item.status === 'ready'
}
