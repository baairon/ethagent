import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ensureConfigDir, getConfigDir } from './config.js'
import { atomicWriteText } from './atomicWrite.js'

const RewindSnapshotSchema = z.object({
  id: z.string().optional(),
  workspaceRoot: z.string().min(1),
  filePath: z.string().min(1),
  relativePath: z.string().optional(),
  existedBefore: z.boolean(),
  previousContent: z.string(),
  changeSummary: z.string().optional(),
  createdAt: z.string(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  messageRole: z.literal('user').optional(),
  promptSnippet: z.string().optional(),
  checkpointLabel: z.string().optional(),
})

type RewindSnapshot = z.infer<typeof RewindSnapshotSchema>
export type RewindEntry = {
  id: string
  workspaceRoot: string
  filePath: string
  relativePath: string
  existedBefore: boolean
  previousContent: string
  changeSummary: string
  createdAt: string
  sessionId?: string
  turnId?: string
  messageRole?: 'user'
  promptSnippet: string
  checkpointLabel: string
}

export type ListRewindEntriesOptions = {
  limit?: number
  offset?: number
}

function getRewindPath(): string {
  return path.join(getConfigDir(), 'rewind.jsonl')
}

export async function recordRewindSnapshot(snapshot: RewindSnapshot): Promise<void> {
  await ensureConfigDir()
  const normalized = normalizeSnapshot(snapshot)
  await fs.appendFile(getRewindPath(), `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function rewindWorkspaceEdits(
  workspaceRoot: string,
  steps = 1,
): Promise<{ reverted: number; files: string[] }> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const snapshots = await loadSnapshots()
  const candidates = snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(entry => path.resolve(entry.snapshot.workspaceRoot) === normalizedWorkspaceRoot)

  if (candidates.length === 0) return { reverted: 0, files: [] }

  const selected = candidates.slice(Math.max(0, candidates.length - steps))
  const revertedFiles: string[] = []

  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const snapshot = selected[index]!.snapshot
    if (snapshot.existedBefore) {
      await fs.mkdir(path.dirname(snapshot.filePath), { recursive: true })
      await fs.writeFile(snapshot.filePath, snapshot.previousContent, 'utf8')
    } else {
      try {
        await fs.unlink(snapshot.filePath)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    revertedFiles.push(snapshot.filePath)
  }

  const selectedIndexes = new Set(selected.map(entry => entry.index))
  const remaining = snapshots.filter((_snapshot, index) => !selectedIndexes.has(index))
  await writeSnapshots(remaining)

  return { reverted: selected.length, files: revertedFiles }
}

async function loadSnapshots(): Promise<RewindSnapshot[]> {
  let raw: string
  try {
    raw = await fs.readFile(getRewindPath(), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const out: RewindSnapshot[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(normalizeSnapshot(RewindSnapshotSchema.parse(JSON.parse(trimmed))))
    } catch {
      continue
    }
  }
  return out
}

export async function listRewindEntries(
  workspaceRoot: string,
  options: ListRewindEntriesOptions = {},
): Promise<RewindEntry[]> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const limit = options.limit ?? 30
  const offset = options.offset ?? 0
  const snapshots = await loadSnapshots()
  return snapshots
    .filter(snapshot => isSnapshotWithinScope(snapshot, normalizedWorkspaceRoot))
    .map(snapshot => toEntry(snapshot))
    .reverse()
    .slice(offset, offset + limit)
}

export async function rewindWorkspaceEditsByEntryIds(
  workspaceRoot: string,
  entryIds: string[],
): Promise<{ reverted: number; files: string[] }> {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  const selectedIds = new Set(entryIds)
  const snapshots = await loadSnapshots()
  const selected = snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(entry =>
      path.resolve(entry.snapshot.workspaceRoot) === normalizedWorkspaceRoot &&
      selectedIds.has(entry.snapshot.id!),
    )

  if (selected.length === 0) return { reverted: 0, files: [] }

  const revertedFiles: string[] = []
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const snapshot = selected[index]!.snapshot
    if (snapshot.existedBefore) {
      await fs.mkdir(path.dirname(snapshot.filePath), { recursive: true })
      await fs.writeFile(snapshot.filePath, snapshot.previousContent, 'utf8')
    } else {
      try {
        await fs.unlink(snapshot.filePath)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    revertedFiles.push(snapshot.filePath)
  }

  const selectedIndexes = new Set(selected.map(entry => entry.index))
  const remaining = snapshots.filter((_snapshot, index) => !selectedIndexes.has(index))
  await writeSnapshots(remaining)

  return { reverted: selected.length, files: revertedFiles }
}

async function writeSnapshots(snapshots: RewindSnapshot[]): Promise<void> {
  await ensureConfigDir()
  const file = getRewindPath()
  const body = snapshots.map(snapshot => JSON.stringify(snapshot)).join('\n')
  await atomicWriteText(file, body ? `${body}\n` : '')
}

function normalizeSnapshot(snapshot: RewindSnapshot): RewindSnapshot {
  const workspaceRoot = path.resolve(snapshot.workspaceRoot)
  const filePath = path.resolve(snapshot.filePath)
  return {
    ...snapshot,
    id: snapshot.id ?? stableSnapshotId(workspaceRoot, filePath, snapshot.createdAt),
    workspaceRoot,
    filePath,
    relativePath: snapshot.relativePath ?? (path.relative(workspaceRoot, filePath) || path.basename(filePath)),
    changeSummary: snapshot.changeSummary ?? (snapshot.existedBefore ? 'restore previous file contents' : 'remove created file'),
    promptSnippet: normalizeSnippet(snapshot.promptSnippet),
    checkpointLabel: normalizeSnippet(snapshot.checkpointLabel) || normalizeSnippet(snapshot.promptSnippet),
  }
}

function toEntry(snapshot: RewindSnapshot): RewindEntry {
  return {
    id: snapshot.id!,
    workspaceRoot: snapshot.workspaceRoot,
    filePath: snapshot.filePath,
    relativePath: snapshot.relativePath!,
    existedBefore: snapshot.existedBefore,
    previousContent: snapshot.previousContent,
    changeSummary: snapshot.changeSummary!,
    createdAt: snapshot.createdAt,
    sessionId: snapshot.sessionId,
    turnId: snapshot.turnId,
    messageRole: snapshot.messageRole,
    promptSnippet: snapshot.promptSnippet ?? '',
    checkpointLabel: snapshot.checkpointLabel ?? snapshot.promptSnippet ?? 'Untitled checkpoint',
  }
}

function stableSnapshotId(workspaceRoot: string, filePath: string, createdAt: string): string {
  const rel = path.relative(workspaceRoot, filePath) || path.basename(filePath)
  return `${createdAt}:${rel}`.replaceAll('\\', '/')
}

function isSnapshotWithinScope(snapshot: RewindSnapshot, scopeRoot: string): boolean {
  if (path.resolve(snapshot.workspaceRoot) === scopeRoot) return true
  const relative = path.relative(scopeRoot, path.resolve(snapshot.filePath))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function normalizeSnippet(input?: string): string {
  const normalized = (input ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`
}
