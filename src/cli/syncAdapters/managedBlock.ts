import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ensureTrailingNewline } from '../../identity/continuity/storage/files.js'
import { normalizeSnapshotContent } from '../../identity/continuity/storage/status.js'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { ManagedRead, SyncContext } from './index.js'

const SYNC_STATE_FILE = '.ethagent-sync.json'

export const START = '<!-- ethagent:start -->'
export const END = '<!-- ethagent:end -->'
const MANAGED_NOTE = '<!-- managed by ethagent; edits between these markers are pulled into your vault automatically. -->'
const SOUL_START = '<!-- ethagent:soul:start -->'
const SOUL_END = '<!-- ethagent:soul:end -->'
const MEMORY_START = '<!-- ethagent:memory:start -->'
const MEMORY_END = '<!-- ethagent:memory:end -->'
const LOCKED_FILE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

async function writeHarnessFile(file: string, text: string): Promise<void> {
  const target = await fs.realpath(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return file
    throw err
  })
  const stat = await fs.stat(target).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  const mode = stat ? stat.mode & 0o777 : 0o644
  try {
    await atomicWriteText(target, text, { mode })
  } catch (err) {
    if (!LOCKED_FILE_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err
    await fs.writeFile(target, text, 'utf8')
  }
}

function stripFirstHeader(value: string): string {
  return value.replace(/^#[^\n]*\n/, '')
}

export function neutralizeManagedMarkers(text: string): string {
  return text.replace(/<!--\s*ethagent:/gi, '<!-- ethagent ')
}

export function sectionKey(fileContent: string): string {
  return normalizeSnapshotContent(stripFirstHeader(fileContent).trim())
}

export function normalizeBody(body: string): string {
  return normalizeSnapshotContent(body.trim())
}

export function renderManagedBlock(context: SyncContext | undefined, extra?: string): string {
  const lines: string[] = [START, MANAGED_NOTE, '']
  if (context) {
    const soul = neutralizeManagedMarkers(stripFirstHeader(context.soul).trim())
    lines.push(SOUL_START)
    if (soul) lines.push(soul)
    lines.push(SOUL_END, '')
    const memory = neutralizeManagedMarkers(stripFirstHeader(context.memory).trim())
    lines.push(MEMORY_START)
    if (memory) lines.push(memory)
    lines.push(MEMORY_END, '')
  }
  const tail = extra?.trim()
  if (tail) lines.push(tail, '')
  lines.push(END)
  return lines.join('\n')
}

export async function injectManagedBlock(filePath: string, block: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let existing = ''
  try { existing = await fs.readFile(filePath, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  let next: string
  const startIdx = existing.indexOf(START)
  const endIdx = existing.indexOf(END)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\n+$/, '')
    const after = existing.slice(endIdx + END.length).replace(/^\n+/, '')
    const parts: string[] = []
    if (before) parts.push(before, '')
    parts.push(block)
    if (after) parts.push('', after)
    next = parts.join('\n').replace(/\n{3,}/g, '\n\n') + (existing.endsWith('\n') ? '\n' : '')
  } else {
    next = existing
      ? `${existing.replace(/\n+$/, '')}\n\n${block}\n`
      : `${block}\n`
  }

  if (next === existing) return
  await writeHarnessFile(filePath, next)
}

export async function hasManagedBlock(filePath: string): Promise<boolean> {
  let existing: string
  try { existing = await fs.readFile(filePath, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
  const startIdx = existing.indexOf(START)
  return startIdx !== -1 && existing.indexOf(END) > startIdx
}

export async function removeManagedBlock(filePath: string): Promise<boolean> {
  let existing: string
  try { existing = await fs.readFile(filePath, 'utf8') } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }

  const startIdx = existing.indexOf(START)
  const endIdx = existing.indexOf(END)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return false

  const before = existing.slice(0, startIdx).replace(/\n+$/, '')
  const after = existing.slice(endIdx + END.length).replace(/^\n+/, '')
  const remainder = [before, after].filter(Boolean).join('\n\n')

  if (remainder.trim() === '') {
    await fs.rm(filePath, { force: true })
  } else {
    await writeHarnessFile(filePath, `${remainder}\n`)
  }
  await fs.rm(syncStatePath(filePath), { force: true })
  return true
}

export function extractOutsideManaged(fileContent: string): string {
  const startIdx = fileContent.indexOf(START)
  const endIdx = fileContent.indexOf(END)
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = fileContent.slice(0, startIdx).replace(/\n+$/, '')
    const after = fileContent.slice(endIdx + END.length).replace(/^\n+/, '')
    return [before, after].filter(Boolean).join('\n\n').trim()
  }
  return fileContent.trim()
}

export function extractManagedExtra(fileContent: string): string | null {
  const startIdx = fileContent.indexOf(START)
  const endIdx = fileContent.indexOf(END)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null
  const inner = fileContent.slice(startIdx + START.length, endIdx)
  const memoryEndIdx = inner.indexOf(MEMORY_END)
  const tail = memoryEndIdx !== -1 ? inner.slice(memoryEndIdx + MEMORY_END.length) : inner
  return tail.replace(MANAGED_NOTE, '').trim()
}

function extractBetween(text: string, start: string, end: string): string | null {
  const startIdx = text.indexOf(start)
  if (startIdx === -1) return null
  const endIdx = text.indexOf(end, startIdx + start.length)
  if (endIdx === -1) return null
  return text.slice(startIdx + start.length, endIdx).trim()
}

export function parseManagedContext(fileContent: string): { soul: string | null; memory: string | null } {
  return {
    soul: extractBetween(fileContent, SOUL_START, SOUL_END),
    memory: extractBetween(fileContent, MEMORY_START, MEMORY_END),
  }
}

export async function readManagedContext(filePath: string): Promise<ManagedRead | null> {
  let content: string
  let mtimeMs: number
  try {
    content = await fs.readFile(filePath, 'utf8')
    mtimeMs = (await fs.stat(filePath)).mtimeMs
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  const { soul, memory } = parseManagedContext(content)
  const { soulHash, memoryHash } = await readManagedSyncState(filePath)
  return {
    soul,
    memory,
    mtimeMs,
    ...(soulHash ? { lastSoulHash: soulHash } : {}),
    ...(memoryHash ? { lastMemoryHash: memoryHash } : {}),
  }
}

export function hashManagedBody(body: string): string {
  return createHash('sha256').update(normalizeBody(body).replace(/\n{3,}/g, '\n\n'), 'utf8').digest('hex')
}

function syncStatePath(managedFilePath: string): string {
  return path.join(path.dirname(managedFilePath), SYNC_STATE_FILE)
}

export async function writeManagedSyncState(managedFilePath: string, context: SyncContext): Promise<void> {
  const state = {
    soulHash: hashManagedBody(stripFirstHeader(context.soul)),
    memoryHash: hashManagedBody(stripFirstHeader(context.memory)),
  }
  await atomicWriteText(syncStatePath(managedFilePath), `${JSON.stringify(state)}\n`, { mode: 0o644 })
}

async function readManagedSyncState(managedFilePath: string): Promise<{ soulHash?: string; memoryHash?: string }> {
  let raw: string
  try {
    raw = await fs.readFile(syncStatePath(managedFilePath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      soulHash: typeof parsed.soulHash === 'string' ? parsed.soulHash : undefined,
      memoryHash: typeof parsed.memoryHash === 'string' ? parsed.memoryHash : undefined,
    }
  } catch {
    return {}
  }
}

export function reconstructVaultFile(currentVaultContent: string, newBody: string, fallbackHeader: string): string {
  const headerMatch = currentVaultContent.match(/^#[^\n]*\n/)
  const header = headerMatch ? headerMatch[0] : `${fallbackHeader}\n`
  return ensureTrailingNewline(`${header}\n${newBody.trim()}\n`)
}
