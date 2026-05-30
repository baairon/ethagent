import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MANIFEST_FILE, mirrorAsSkillFolders, pathExists, readManifest, type PublicSkill } from './shared.js'
import { injectManagedBlock, readManagedContext, renderManagedBlock, writeManagedSyncState } from './managedBlock.js'
import type { ManagedRead, SyncContext } from './index.js'

function claudeDir(): string {
  return path.join(os.homedir(), '.claude')
}

function claudeSkillsDir(): string {
  return path.join(claudeDir(), 'skills')
}

function claudeMdPath(): string {
  return path.join(claudeDir(), 'CLAUDE.md')
}

function claudeProjectMemoryMdPath(): string {
  const slug = process.cwd().replace(/[:\\\/]/g, '-')
  return path.join(claudeDir(), 'projects', slug, 'memory', 'MEMORY.md')
}

// The Claude Code native per-project memory directory for the current project.
// ethagent's portable memory supersedes this; the --memory-guard hook redirects
// the model away from writing here so nothing siloes on one machine.
export function claudeCodeNativeMemoryDir(): string {
  return path.dirname(claudeProjectMemoryMdPath())
}

// Every project's mirrored MEMORY.md under a given ~/.claude root, across all
// directories the agent has ever been synced in, not just the current cwd.
// Reset uses this so no project is left whispering a stale ethagent block.
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
  description: 'Mirror public skills into ~/.claude/skills and inject soul/memory into ~/.claude/CLAUDE.md and the project MEMORY.md.',
  async detect(): Promise<boolean> {
    return pathExists(claudeDir())
  },
  async readManaged(): Promise<ManagedRead | null> {
    return readManagedContext(claudeMdPath())
  },
  managedFilePaths(): string[] {
    return [claudeMdPath()]
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
      }
      await writeManagedSyncState(claudeMdPath(), context)
    }
    return result
  },
}
