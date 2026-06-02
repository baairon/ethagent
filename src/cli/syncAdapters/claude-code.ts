import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MANIFEST_FILE, mirrorAsSkillFolders, pathExists, readManifest, type PublicSkill } from './shared.js'
import { injectManagedBlock, readManagedContext, renderManagedBlock, writeManagedSyncState } from './managedBlock.js'
import type { ManagedRead, SyncContext } from './index.js'

function claudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

export function claudeSkillsDir(): string {
  return path.join(claudeDir(), 'skills')
}

function claudeMdPath(): string {
  return path.join(claudeDir(), 'CLAUDE.md')
}

function claudeProjectMemoryMdPath(): string {
  const slug = process.cwd().replace(/[:\\\/]/g, '-')
  return path.join(claudeDir(), 'projects', slug, 'memory', 'MEMORY.md')
}

export function claudeCodeNativeMemoryDir(): string {
  return path.dirname(claudeProjectMemoryMdPath())
}

export async function projectMemoryMirrorsUnder(claudeRoot: string): Promise<string[]> {
  const projectsDir = path.join(claudeRoot, 'projects')
  let slugs: string[]
  try {
    slugs = await fs.readdir(projectsDir)
  } catch {
    return []
  }
  const mirrors: string[] = []
  for (const slug of slugs) {
    const file = path.join(projectsDir, slug, 'memory', 'MEMORY.md')
    if (await pathExists(file)) mirrors.push(file)
  }
  return mirrors
}

export const claudeCodeAdapter = {
  name: 'claude-code' as const,
  description: 'Mirror skills (public and private) into ~/.claude/skills and inject soul/memory into ~/.claude/CLAUDE.md and the project MEMORY.md.',
  async detect(): Promise<boolean> {
    return pathExists(claudeDir())
  },
  async readManaged(): Promise<ManagedRead | null> {
    return readManagedContext(claudeMdPath())
  },
  managedFilePaths(): string[] {
    return [claudeMdPath(), claudeProjectMemoryMdPath()]
  },
  async resetManagedFilePaths(): Promise<string[]> {
    return [claudeMdPath(), ...(await projectMemoryMirrorsUnder(claudeDir()))]
  },
  async cleanup(): Promise<void> {
    const skillsDir = claudeSkillsDir()
    const manifest = await readManifest(skillsDir)
    await Promise.all(
      manifest.skills.map(name =>
        fs.rm(path.join(skillsDir, name), { recursive: true, force: true }).catch(() => {})
      )
    )
    await fs.rm(path.join(skillsDir, MANIFEST_FILE), { force: true }).catch(() => {})
  },
  async mirror(skills: PublicSkill[], context?: SyncContext): Promise<{ count: number; skipped: number }> {
    const result = await mirrorAsSkillFolders(claudeSkillsDir(), skills)
    if (context) {
      for (const target of [claudeMdPath(), claudeProjectMemoryMdPath()]) {
        await injectManagedBlock(target, renderManagedBlock(context))
        await writeManagedSyncState(target, context)
      }
    }
    return result
  },
}
