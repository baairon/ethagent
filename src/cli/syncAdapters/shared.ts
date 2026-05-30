import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillIndexEntry } from '../../identity/continuity/skills/types.js'

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
    const targetFile = path.join(targetDir, 'SKILL.md')
    const exists = await pathExists(targetDir)
    const isOurs = manifest.skills.includes(skill.name)
    if (exists && !isOurs) { skipped++; continue }
    try {
      const body = await fs.readFile(skill.absolutePath, 'utf8')
      await fs.mkdir(targetDir, { recursive: true })
      await fs.writeFile(targetFile, body, 'utf8')
      owned.push(skill.name)
    } catch {}
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
