import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseSkillFile } from '../../identity/continuity/skills/frontmatter.js'
import { pathExists, type PublicSkill } from './shared.js'
import { injectManagedBlock, readManagedContext, renderManagedBlock, writeManagedSyncState } from './managedBlock.js'
import type { ManagedRead, SyncContext } from './index.js'

function codexDir(): string {
  return path.join(os.homedir(), '.codex')
}

function agentsFilePath(): string {
  return path.join(codexDir(), 'AGENTS.md')
}

type EnrichedSkill = PublicSkill & { body: string }

async function enrichSkills(skills: PublicSkill[]): Promise<EnrichedSkill[]> {
  const out: EnrichedSkill[] = []
  for (const skill of skills) {
    try {
      const raw = await fs.readFile(skill.absolutePath, 'utf8')
      const { body } = parseSkillFile(raw)
      out.push({ ...skill, body })
    } catch {}
  }
  return out
}

function neutralizeManagedMarkers(text: string): string {
  return text.replace(/<!--\s*ethagent:/gi, '<!-- ethagent ')
}

function renderSkillsText(skills: EnrichedSkill[]): string {
  if (skills.length === 0) return '_no skills synced yet._'
  const lines: string[] = []
  for (const skill of skills) {
    lines.push(`## ${neutralizeManagedMarkers(skill.displayName ?? skill.name)}`, '')
    if (skill.description) lines.push(neutralizeManagedMarkers(skill.description), '')
    if (skill.body) lines.push(neutralizeManagedMarkers(skill.body), '')
  }
  return lines.join('\n').trim()
}

export const codexAdapter = {
  name: 'codex' as const,
  description: 'Merge soul, memory, and skill content (public and private) into ~/.codex/AGENTS.md between ethagent markers.',
  async detect(): Promise<boolean> {
    return pathExists(path.join(codexDir(), 'config.toml'))
  },
  async readManaged(): Promise<ManagedRead | null> {
    return readManagedContext(agentsFilePath())
  },
  managedFilePaths(): string[] {
    return [agentsFilePath()]
  },
  async mirror(skills: PublicSkill[], context?: SyncContext): Promise<{ count: number; skipped: number }> {
    await fs.mkdir(codexDir(), { recursive: true })
    const enriched = await enrichSkills(skills)
    const block = renderManagedBlock(context, renderSkillsText(enriched))
    await injectManagedBlock(agentsFilePath(), block)
    if (context) await writeManagedSyncState(agentsFilePath(), context)
    return { count: enriched.length, skipped: 0 }
  },
}
