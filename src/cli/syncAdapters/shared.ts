import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import type { SkillIndexEntry } from '../../identity/continuity/skills/types.js'
import {
  isBuildCacheName,
  isReservedWindowsSegment,
  isValidFilenameSegment,
  isValidSegment,
  MAX_FOLDER_DEPTH,
  MAX_SKILL_FILE_BYTES,
} from '../../identity/continuity/skills/skillPaths.js'
import { sanitizeSkillFileForStrictYaml } from '../../identity/continuity/skills/frontmatter.js'

const SKILL_MIRROR_FORMAT = '3'

export type PublicSkill = SkillIndexEntry

export const MANIFEST_FILE = '.ethagent-managed.json'
export const MIRROR_MARKER = '.ethagent-mirror'
const TRASH_DIR = '.ethagent-trash'
const MANIFEST_RETRY_MS = 50

export type Manifest = {
  version: 1
  managedAt: string
  skills: string[]
  sigs?: Record<string, string>
}

type ManifestRead = { state: 'ok'; manifest: Manifest } | { state: 'missing' } | { state: 'unreadable' }

type Ownership = { names: Set<string>; sigs: Record<string, string> }

function parseManifest(raw: string): Manifest | null {
  try {
    const parsed = JSON.parse(raw) as Manifest
    if (parsed.version === 1 && Array.isArray(parsed.skills)) {
      const sigs = parsed.sigs && typeof parsed.sigs === 'object' ? parsed.sigs : undefined
      return { version: 1, managedAt: parsed.managedAt, skills: parsed.skills, ...(sigs ? { sigs } : {}) }
    }
  } catch {}
  return null
}

async function loadManifest(root: string): Promise<ManifestRead> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'missing' } : { state: 'unreadable' }
  }
  const manifest = parseManifest(raw)
  return manifest ? { state: 'ok', manifest } : { state: 'unreadable' }
}

export async function readManifest(root: string): Promise<Manifest> {
  const read = await loadManifest(root)
  return read.state === 'ok' ? read.manifest : { version: 1, managedAt: new Date(0).toISOString(), skills: [] }
}

export async function writeManifest(root: string, owned: string[], sigs?: Record<string, string>): Promise<void> {
  const next: Manifest = { version: 1, managedAt: new Date().toISOString(), skills: owned, ...(sigs ? { sigs } : {}) }
  await atomicWriteText(path.join(root, MANIFEST_FILE), JSON.stringify(next, null, 2) + '\n', { mode: 0o644 })
}

async function markedFolders(root: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const marked: string[] = []
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.') || !isValidSegment(ent.name)) continue
    if (await pathExists(path.join(root, ent.name, MIRROR_MARKER))) marked.push(ent.name)
  }
  return marked
}

export async function skippedSkillFolders(root: string, names: readonly string[]): Promise<string[]> {
  const [read, marked] = await Promise.all([loadManifest(root), markedFolders(root)])
  if (read.state === 'unreadable') return []
  const owned = new Set(read.state === 'ok' ? read.manifest.skills : [])
  const markedNames = new Set(marked)
  const skipped: string[] = []
  for (const name of new Set(names)) {
    if (owned.has(name) || markedNames.has(name) || !isValidSegment(name)) continue
    const folder = await fs.stat(path.join(root, name)).catch(() => null)
    if (folder?.isDirectory()) skipped.push(name)
  }
  return skipped
}

async function readOwnership(root: string): Promise<Ownership | null> {
  let read = await loadManifest(root)
  if (read.state === 'unreadable') {
    await new Promise(resolve => setTimeout(resolve, MANIFEST_RETRY_MS))
    read = await loadManifest(root)
  }
  const marked = await markedFolders(root)
  if (read.state === 'unreadable') {
    if (marked.length === 0) {
      process.stderr.write(`ethagent: left ${root} as is because ${MANIFEST_FILE} there is unreadable\n`)
      return null
    }
    process.stderr.write(`ethagent: ${MANIFEST_FILE} in ${root} is unreadable, so ownership comes from the mirror markers\n`)
  }
  const names = new Set(marked)
  if (read.state !== 'ok') return { names, sigs: {} }
  for (const name of read.manifest.skills) names.add(name)
  return { names, sigs: read.manifest.sigs ?? {} }
}

async function writeMirrorMarker(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, MIRROR_MARKER), 'Mirrored by ethagent from the vault. Edit the skill in the vault; changes here are overwritten.\n')
}

async function moveToTrash(root: string, name: string): Promise<string | null> {
  const target = path.join(root, name)
  if (!(await pathExists(target))) return null
  const trashed = path.join(root, TRASH_DIR, `${name}.${randomBytes(4).toString('hex')}`)
  await fs.mkdir(path.dirname(trashed), { recursive: true })
  await fs.rename(target, trashed)
  return trashed
}

async function replaceSkillFolder(root: string, name: string, stagedDir: string): Promise<void> {
  const target = path.join(root, name)
  const trashed = await moveToTrash(root, name)
  try {
    await fs.rename(stagedDir, target)
  } catch (err) {
    if (trashed) await fs.rename(trashed, target).catch(() => null)
    throw err
  }
  if (trashed) await fs.rm(trashed, { recursive: true, force: true }).catch(() => null)
}

async function removeOwnedFolder(root: string, name: string): Promise<boolean> {
  if (!isValidSegment(name)) return true
  try {
    const trashed = await moveToTrash(root, name)
    if (trashed) await fs.rm(trashed, { recursive: true, force: true }).catch(() => null)
    return true
  } catch (err) {
    process.stderr.write(`ethagent: failed to remove mirrored skill "${name}": ${(err as Error).message}\n`)
    return false
  }
}

export async function removeMirroredSkills(root: string): Promise<void> {
  const ownership = await readOwnership(root)
  if (!ownership) return
  const left: string[] = []
  for (const name of ownership.names) {
    if (!(await removeOwnedFolder(root, name))) left.push(name)
  }
  await fs.rm(path.join(root, TRASH_DIR), { recursive: true, force: true }).catch(() => null)
  if (left.length > 0) await writeManifest(root, left)
  else await fs.rm(path.join(root, MANIFEST_FILE), { force: true }).catch(() => null)
}

export async function pathExists(file: string): Promise<boolean> {
  try { await fs.access(file); return true } catch { return false }
}

async function copyVettedSkillTree(srcDir: string, destDir: string, depth = 0): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH) return
  await fs.mkdir(destDir, { recursive: true })
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue
    if (ent.name.startsWith('.')) continue
    if (isReservedWindowsSegment(ent.name)) continue
    if (isBuildCacheName(ent.name)) continue
    const srcPath = path.join(srcDir, ent.name)
    const destPath = path.join(destDir, ent.name)
    if (ent.isDirectory()) {
      if (!isValidSegment(ent.name)) continue
      await copyVettedSkillTree(srcPath, destPath, depth + 1)
    } else if (ent.isFile()) {
      if (!isValidFilenameSegment(ent.name)) continue
      const stat = await fs.stat(srcPath).catch(() => null)
      if (!stat || stat.size > MAX_SKILL_FILE_BYTES) continue
      if (depth === 0 && ent.name.toLowerCase() === 'skill.md' && await writeSanitizedSkillFile(srcPath, destPath)) continue
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function writeSanitizedSkillFile(srcPath: string, destPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(srcPath, 'utf8')
    await fs.writeFile(destPath, sanitizeSkillFileForStrictYaml(raw))
    return true
  } catch {
    return false
  }
}

async function collectSignature(srcDir: string, rel = '', depth = 0): Promise<string[]> {
  if (depth > MAX_FOLDER_DEPTH) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true })
  } catch {
    return []
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const parts: string[] = []
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue
    if (ent.name.startsWith('.')) continue
    if (isReservedWindowsSegment(ent.name)) continue
    if (isBuildCacheName(ent.name)) continue
    const abs = path.join(srcDir, ent.name)
    const relPath = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      if (!isValidSegment(ent.name)) continue
      parts.push(...(await collectSignature(abs, relPath, depth + 1)))
    } else if (ent.isFile()) {
      if (!isValidFilenameSegment(ent.name)) continue
      const stat = await fs.stat(abs).catch(() => null)
      if (!stat || stat.size > MAX_SKILL_FILE_BYTES) continue
      const buf = await fs.readFile(abs).catch(() => null)
      if (!buf) continue
      parts.push(`${relPath} ${createHash('sha256').update(buf).digest('hex')}`)
    }
  }
  return parts
}

async function signatureOf(srcDir: string): Promise<string> {
  const parts = await collectSignature(srcDir)
  return createHash('sha256').update(`${SKILL_MIRROR_FORMAT}\n${parts.join('\n')}`).digest('hex')
}

export async function mirrorAsSkillFolders(
  root: string,
  skills: PublicSkill[],
): Promise<{ count: number; skipped: number }> {
  await fs.mkdir(root, { recursive: true })
  if (!(await pathExists(path.join(root, '.gitignore')))) {
    await fs.writeFile(path.join(root, '.gitignore'), '*\n').catch(() => null)
  }
  const ownership = await readOwnership(root)
  if (!ownership) return { count: 0, skipped: 0 }
  const incoming = new Set(skills.map(s => s.name))
  const owned: string[] = []
  const sigs: Record<string, string> = {}
  let skipped = 0
  for (const skill of skills) {
    const targetDir = path.join(root, skill.name)
    const exists = await pathExists(targetDir)
    const isOurs = ownership.names.has(skill.name)
    if (exists && !isOurs) { skipped++; continue }
    const srcDir = path.dirname(skill.absolutePath)
    const sig = await signatureOf(srcDir)
    if (exists && isOurs && ownership.sigs[skill.name] === sig) {
      if (!(await pathExists(path.join(targetDir, MIRROR_MARKER)))) await writeMirrorMarker(targetDir).catch(() => null)
      owned.push(skill.name)
      sigs[skill.name] = sig
      continue
    }
    const tmpDir = path.join(root, `.${skill.name}.ethagent-tmp`)
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
      await copyVettedSkillTree(srcDir, tmpDir)
      await writeMirrorMarker(tmpDir)
      await replaceSkillFolder(root, skill.name, tmpDir)
      owned.push(skill.name)
      sigs[skill.name] = sig
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
      process.stderr.write(`ethagent: failed to mirror skill "${skill.name}": ${(err as Error).message}\n`)
    }
  }
  const keep = new Set<string>(owned)
  for (const name of ownership.names) if (incoming.has(name)) keep.add(name)
  for (const stale of ownership.names) {
    if (keep.has(stale)) continue
    if (!(await removeOwnedFolder(root, stale))) keep.add(stale)
  }
  await fs.rm(path.join(root, TRASH_DIR), { recursive: true, force: true }).catch(() => null)
  const keptSigs: Record<string, string> = {}
  for (const name of keep) if (sigs[name]) keptSigs[name] = sigs[name]
  await writeManifest(root, [...keep], keptSigs)
  return { count: owned.length, skipped }
}
