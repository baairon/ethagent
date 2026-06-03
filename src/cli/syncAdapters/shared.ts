import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { SkillIndexEntry } from '../../identity/continuity/skills/types.js'
import {
  isReservedWindowsSegment,
  isValidFilenameSegment,
  isValidSegment,
  MAX_FOLDER_DEPTH,
} from '../../identity/continuity/skills/skillPaths.js'
import { sanitizeSkillFileForStrictYaml } from '../../identity/continuity/skills/frontmatter.js'

const MAX_MIRROR_FILE_BYTES = 256 * 1024
// Bump when the mirror's on-disk output changes (e.g. SKILL.md frontmatter re-serialization),
// so every existing mirror is rewritten once through the new logic instead of being skipped
// as "unchanged".
const SKILL_MIRROR_FORMAT = '3'

export type PublicSkill = SkillIndexEntry

export const MANIFEST_FILE = '.ethagent-managed.json'

export type Manifest = {
  version: 1
  managedAt: string
  skills: string[]
  /** Per-skill content signature so an unchanged skill is not needlessly rewritten. */
  sigs?: Record<string, string>
}

export async function readManifest(root: string): Promise<Manifest> {
  try {
    const raw = await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Manifest
    if (parsed.version === 1 && Array.isArray(parsed.skills)) {
      const sigs = parsed.sigs && typeof parsed.sigs === 'object' ? parsed.sigs : undefined
      return { version: 1, managedAt: parsed.managedAt, skills: parsed.skills, ...(sigs ? { sigs } : {}) }
    }
  } catch { /* missing or corrupt manifest -> fall back to an empty one */ }
  return { version: 1, managedAt: new Date(0).toISOString(), skills: [] }
}

export async function writeManifest(root: string, owned: string[], sigs?: Record<string, string>): Promise<void> {
  const next: Manifest = { version: 1, managedAt: new Date().toISOString(), skills: owned, ...(sigs ? { sigs } : {}) }
  await fs.writeFile(path.join(root, MANIFEST_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8')
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
    const srcPath = path.join(srcDir, ent.name)
    const destPath = path.join(destDir, ent.name)
    if (ent.isDirectory()) {
      if (!isValidSegment(ent.name)) continue
      await copyVettedSkillTree(srcPath, destPath, depth + 1)
    } else if (ent.isFile()) {
      if (!isValidFilenameSegment(ent.name)) continue
      const stat = await fs.stat(srcPath).catch(() => null)
      if (!stat || stat.size > MAX_MIRROR_FILE_BYTES) continue
      // Re-emit the entry SKILL.md with strict-valid YAML frontmatter so harnesses with a
      // strict parser (e.g. Codex) can load it even when the source uses lenient unquoted
      // values; everything else is copied byte-for-byte.
      if (depth === 0 && ent.name.toLowerCase() === 'skill.md' && await writeSanitizedSkillFile(srcPath, destPath)) continue
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function writeSanitizedSkillFile(srcPath: string, destPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(srcPath, 'utf8')
    // Re-quote frontmatter scalars for strict parsers (Codex) while preserving every key and
    // the body verbatim, so no skill loses allowed-tools/model/custom keys and none goes nameless.
    await fs.writeFile(destPath, sanitizeSkillFileForStrictYaml(raw))
    return true
  } catch {
    return false
  }
}

/**
 * Deterministic content signature of the vetted skill tree (sorted relative path + file
 * hash, same filters as the copy). Lets the mirror skip rewriting a skill whose source has
 * not changed, which avoids needless disk churn and, critically, a watch -> sync -> rewrite
 * -> watch feedback loop on recursive-watch platforms (Windows/macOS).
 */
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
    const abs = path.join(srcDir, ent.name)
    const relPath = rel ? `${rel}/${ent.name}` : ent.name
    if (ent.isDirectory()) {
      if (!isValidSegment(ent.name)) continue
      parts.push(...(await collectSignature(abs, relPath, depth + 1)))
    } else if (ent.isFile()) {
      if (!isValidFilenameSegment(ent.name)) continue
      const stat = await fs.stat(abs).catch(() => null)
      if (!stat || stat.size > MAX_MIRROR_FILE_BYTES) continue
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
  // Keep mirrored skill files (including private ones) from being accidentally committed when
  // a generic target's dir is inside a git repo. The dotfile is ignored by the daemon watcher.
  if (!(await pathExists(path.join(root, '.gitignore')))) {
    await fs.writeFile(path.join(root, '.gitignore'), '*\n').catch(() => null)
  }
  const manifest = await readManifest(root)
  const prevSigs = manifest.sigs ?? {}
  const incoming = new Set(skills.map(s => s.name))
  const owned: string[] = []
  const sigs: Record<string, string> = {}
  let skipped = 0
  for (const skill of skills) {
    const targetDir = path.join(root, skill.name)
    const exists = await pathExists(targetDir)
    const isOurs = manifest.skills.includes(skill.name)
    if (exists && !isOurs) { skipped++; continue }
    const srcDir = path.dirname(skill.absolutePath)
    const sig = await signatureOf(srcDir)
    // Unchanged since we last wrote it: keep it, but do not rewrite (no churn, no watch loop).
    if (exists && isOurs && prevSigs[skill.name] === sig) {
      owned.push(skill.name)
      sigs[skill.name] = sig
      continue
    }
    const tmpDir = path.join(root, `.${skill.name}.ethagent-tmp`)
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
      await copyVettedSkillTree(srcDir, tmpDir)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.rename(tmpDir, targetDir)
      owned.push(skill.name)
      sigs[skill.name] = sig
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
      process.stderr.write(`ethagent: failed to mirror skill "${skill.name}": ${(err as Error).message}\n`)
    }
  }
  const keep = new Set<string>(owned)
  for (const name of manifest.skills) if (incoming.has(name)) keep.add(name)
  for (const stale of manifest.skills) {
    if (keep.has(stale)) continue
    // Never rm a name that isn't a single safe segment: a tampered/corrupt manifest with
    // '..' or a separator could otherwise escape root and delete an unrelated directory.
    if (!isValidSegment(stale)) continue
    await fs.rm(path.join(root, stale), { recursive: true, force: true }).catch(() => null)
  }
  const keptSigs: Record<string, string> = {}
  for (const name of keep) if (sigs[name]) keptSigs[name] = sigs[name]
  await writeManifest(root, [...keep], keptSigs)
  return { count: owned.length, skipped }
}
