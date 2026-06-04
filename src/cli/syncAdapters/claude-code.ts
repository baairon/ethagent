import fs from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MANIFEST_FILE, mirrorAsSkillFolders, pathExists, readManifest, type PublicSkill } from './shared.js'
import { isValidSegment } from '../../identity/continuity/skills/skillPaths.js'
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

function claudeSettingsPath(): string {
  return path.join(claudeDir(), 'settings.json')
}

type HookSpec = { event: string; matcher?: string; command: string }

const ETHAGENT_HOOKS: HookSpec[] = [
  { event: 'SessionStart', command: 'npx -y ethagent --session-start' },
  { event: 'PreToolUse', matcher: 'Edit|Write|MultiEdit', command: 'npx -y ethagent --pretool-guard' },
  { event: 'PostToolUse', matcher: 'Edit|Write|MultiEdit', command: 'npx -y ethagent --sync-on-edit' },
]
const ETHAGENT_HOOK_COMMANDS = new Set(ETHAGENT_HOOKS.map(h => h.command))

type HookEntry = { type: string; command: string }
type HookGroup = { matcher?: string; hooks: HookEntry[] }

function groupHasCommand(groups: HookGroup[], command: string): boolean {
  return groups.some(g => Array.isArray(g.hooks) && g.hooks.some(h => h?.command === command))
}

/**
 * Idempotently merge ethagent's hooks into ~/.claude/settings.json so autosync works
 * even without the marketplace plugin. Never clobbers existing user hooks or other keys.
 * Returns true if the file was changed.
 */
export async function mergeClaudeHooks(): Promise<boolean> {
  const settingsPath = claudeSettingsPath()
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse((await fs.readFile(settingsPath, 'utf8')).replace(/^﻿/, '')) as unknown
    if (parsed && typeof parsed === 'object') settings = parsed as Record<string, unknown>
  } catch { /* missing or unparseable -> start from an empty settings object */ }

  const hooks = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as Record<string, HookGroup[]>
  let changed = false
  for (const spec of ETHAGENT_HOOKS) {
    const existing = hooks[spec.event]
    const groups: HookGroup[] = Array.isArray(existing) ? existing : []
    if (groupHasCommand(groups, spec.command)) continue
    const group: HookGroup = {
      ...(spec.matcher ? { matcher: spec.matcher } : {}),
      hooks: [{ type: 'command', command: spec.command }],
    }
    hooks[spec.event] = [...groups, group]
    changed = true
  }
  if (!changed) return false
  settings.hooks = hooks
  await fs.mkdir(claudeDir(), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  return true
}

/**
 * Remove ethagent's self-installed hooks from settings.json (the inverse of mergeClaudeHooks):
 * so `reset` leaves no orphaned automation, and installing the marketplace plugin after the
 * CLI ran does not double-fire. All other hooks and keys are left intact. Returns true if the
 * file changed.
 */
export async function removeClaudeHooks(): Promise<boolean> {
  const settingsPath = claudeSettingsPath()
  let settings: Record<string, unknown>
  try {
    const parsed = JSON.parse((await fs.readFile(settingsPath, 'utf8')).replace(/^﻿/, '')) as unknown
    if (!parsed || typeof parsed !== 'object') return false
    settings = parsed as Record<string, unknown>
  } catch {
    return false
  }
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return false
  const hookMap = hooks as Record<string, HookGroup[]>
  let changed = false
  for (const event of Object.keys(hookMap)) {
    const groups = hookMap[event]
    if (!Array.isArray(groups)) continue
    const kept: HookGroup[] = []
    for (const group of groups) {
      const list = Array.isArray(group.hooks) ? group.hooks : []
      // Match only the exact commands we install, so a user's own hook that merely mentions
      // ethagent (e.g. a Stop hook running `npx ethagent save`) is never silently removed.
      const filtered = list.filter(h => !(typeof h?.command === 'string' && ETHAGENT_HOOK_COMMANDS.has(h.command)))
      if (filtered.length !== list.length) changed = true
      if (filtered.length > 0) kept.push({ ...group, hooks: filtered })
    }
    if (kept.length > 0) hookMap[event] = kept
    else delete hookMap[event]
  }
  if (!changed) return false
  if (Object.keys(hookMap).length === 0) delete settings.hooks
  else settings.hooks = hookMap
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  return true
}

function dirMentions(dir: string, needle: string, depth: number): boolean {
  if (depth < 0) return false
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const ent of entries) {
    if (ent.name.toLowerCase().includes(needle)) return true
    if (ent.isDirectory() && dirMentions(path.join(dir, ent.name), needle, depth - 1)) return true
  }
  return false
}

/** Best-effort detection of the ethagent Claude Code marketplace plugin install. */
export function marketplacePluginInstalled(): boolean {
  return dirMentions(path.join(claudeDir(), 'plugins'), 'ethagent', 3)
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

/**
 * Every project MEMORY.md this adapter mirrors into: all existing
 * projects/<slug>/memory/MEMORY.md files plus the current session's project path
 * (so a brand-new project's mirror is still created by the foreground, correctly
 * cwd'd, session). Enumerating the existing mirrors makes mirror/read/watch
 * cwd-independent: the long-lived daemon inherits a frozen cwd, so without this it
 * would keep writing only its original project's MEMORY.md and starve whichever
 * project the user actually moved to. The vault soul/memory is global to the agent,
 * so the same managed block is correct for every project mirror.
 */
async function projectMemoryTargets(): Promise<string[]> {
  return [...new Set([...(await projectMemoryMirrorsUnder(claudeDir())), claudeProjectMemoryMdPath()])]
}

export const claudeCodeAdapter = {
  name: 'claude-code' as const,
  description: 'Mirror skills (public and private) into ~/.claude/skills and inject soul/memory into ~/.claude/CLAUDE.md and the project MEMORY.md.',
  capabilities: { nativeHooks: true },
  async detect(): Promise<boolean> {
    return pathExists(claudeDir())
  },
  async bootstrap(): Promise<string[]> {
    // The marketplace plugin is the gold-standard Claude Code path; when it is present
    // it already wires the hooks, so do not also self-install (that would double-fire).
    // Also strip any hooks a prior CLI run self-installed, so the two paths never overlap.
    if (marketplacePluginInstalled()) {
      const removed = await removeClaudeHooks()
      return [removed
        ? 'claude-code: marketplace plugin detected; removed redundant self-installed hooks (plugin drives sync)'
        : 'claude-code: marketplace plugin detected, it drives sync (no settings.json hooks needed)']
    }
    const changed = await mergeClaudeHooks()
    return changed
      ? [`claude-code: installed session-start, pretool-guard, and sync-on-edit hooks in ${claudeSettingsPath()}`]
      : []
  },
  async readManaged(): Promise<ManagedRead | null> {
    return readManagedContext(claudeMdPath())
  },
  // One read per managed file (global CLAUDE.md + every project MEMORY.md) so
  // reconcile honors each file's newest edit. Without this the project MEMORY.md is
  // a write-only mirror target and edits landing there never reach the vault.
  async readManagedCandidates(): Promise<ManagedRead[]> {
    const reads: ManagedRead[] = []
    for (const target of [claudeMdPath(), ...(await projectMemoryTargets())]) {
      const read = await readManagedContext(target)
      if (read) reads.push(read)
    }
    return reads
  },
  managedFilePaths(): string[] {
    return [claudeMdPath(), claudeProjectMemoryMdPath()]
  },
  async managedFilePathsAsync(): Promise<string[]> {
    return projectMemoryTargets()
  },
  async resetManagedFilePaths(): Promise<string[]> {
    return [claudeMdPath(), ...(await projectMemoryMirrorsUnder(claudeDir()))]
  },
  async cleanup(): Promise<void> {
    const skillsDir = claudeSkillsDir()
    const manifest = await readManifest(skillsDir)
    await Promise.all(
      manifest.skills
        .filter(name => isValidSegment(name))
        .map(name => fs.rm(path.join(skillsDir, name), { recursive: true, force: true }).catch(() => {}))
    )
    await fs.rm(path.join(skillsDir, MANIFEST_FILE), { force: true }).catch(() => {})
  },
  async mirror(skills: PublicSkill[], context?: SyncContext): Promise<{ count: number; skipped: number }> {
    const result = await mirrorAsSkillFolders(claudeSkillsDir(), skills)
    if (context) {
      for (const target of [claudeMdPath(), ...(await projectMemoryTargets())]) {
        await injectManagedBlock(target, renderManagedBlock(context))
        await writeManagedSyncState(target, context)
      }
    }
    return result
  },
}
