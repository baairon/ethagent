import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillIndexEntry } from '../../identity/continuity/skills/types.js'
import {
  isReservedWindowsSegment,
  isValidFilenameSegment,
  isValidSegment,
  MAX_FOLDER_DEPTH,
} from '../../identity/continuity/skills/skillPaths.js'

// Cap copied files at the same size the vault loader enforces.
const MAX_MIRROR_FILE_BYTES = 256 * 1024

export type PublicSkill = SkillIndexEntry

export const MANIFEST_FILE = '.ethagent-managed.json'

export type Manifest = {
  version: 1
  managedAt: string
  skills: string[]
}

export async function readManifest(root: string): Promise<Manifest> {
  try {
    const raw = await fs.readFile(path.join(root, MANIFEST_FILE), 'utf8')
    const parsed = JSON.parse(raw) as Manifest
    if (parsed.version === 1 && Array.isArray(parsed.skills)) return parsed
  } catch {}
  return { version: 1, managedAt: new Date(0).toISOString(), skills: [] }
}

export async function writeManifest(root: string, owned: string[]): Promise<void> {
  const next: Manifest = { version: 1, managedAt: new Date().toISOString(), skills: owned }
  await fs.writeFile(path.join(root, MANIFEST_FILE), JSON.stringify(next, null, 2) + '\n', 'utf8')
}

export async function pathExists(file: string): Promise<boolean> {
  try { await fs.access(file); return true } catch { return false }
}

/**
 * Copy a vault skill folder into the harness, applying the SAME vetting the
 * vault loader uses (skip symlinks, dotfiles, reserved Windows names, invalid
 * segments, and oversize files) so the mirror never copies a superset of — or a
 * symlink escaping — the vault's recognized file set.
 */
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
      await fs.copyFile(srcPath, destPath)
    }
  }
}

export async function mirrorAsSkillFolders(
  root: string,
  skills: PublicSkill[],
): Promise<{ count: number; skipped: number }> {
  await fs.mkdir(root, { recursive: true })
  const manifest = await readManifest(root)
  const incoming = new Set(skills.map(s => s.name))
  const owned: string[] = []
  let skipped = 0
  for (const skill of skills) {
    const targetDir = path.join(root, skill.name)
    const exists = await pathExists(targetDir)
    const isOurs = manifest.skills.includes(skill.name)
    if (exists && !isOurs) { skipped++; continue }
    const srcDir = path.dirname(skill.absolutePath)
    const tmpDir = path.join(root, `.${skill.name}.ethagent-tmp`)
    try {
      // Stage the new copy in a temp sibling, then swap it in. This keeps the
      // existing managed copy intact if the copy fails (no destructive
      // rm-before-write window), and refreshes the whole folder (scripts/,
      // assets/), dropping files removed upstream.
      await fs.rm(tmpDir, { recursive: true, force: true })
      await copyVettedSkillTree(srcDir, tmpDir)
      await fs.rm(targetDir, { recursive: true, force: true })
      await fs.rename(tmpDir, targetDir)
      owned.push(skill.name)
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => null)
      process.stderr.write(`ethagent: failed to mirror skill "${skill.name}": ${(err as Error).message}\n`)
    }
  }
  const keep = new Set<string>(owned)
  for (const name of manifest.skills) if (incoming.has(name)) keep.add(name)
  for (const stale of manifest.skills) {
    if (keep.has(stale)) continue
    await fs.rm(path.join(root, stale), { recursive: true, force: true }).catch(() => null)
  }
  await writeManifest(root, [...keep])
  return { count: owned.length, skipped }
}
