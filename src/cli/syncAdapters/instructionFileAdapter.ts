import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseSkillFile } from '../../identity/continuity/skills/frontmatter.js'
import { MANIFEST_FILE, mirrorAsSkillFolders, pathExists, readManifest, type PublicSkill } from './shared.js'
import { isValidSegment } from '../../identity/continuity/skills/skillPaths.js'
import { injectManagedBlock, neutralizeManagedMarkers, readManagedContext, renderManagedBlock, writeManagedSyncState } from './managedBlock.js'
import { preserveHarnessSkillEdits, writeLastExtraHash } from './skillEdits.js'
import { buildPortableInstruction } from '../harnessGuidance.js'
import type { ManagedRead, SyncContext, SyncAdapter } from './index.js'

export function homePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments)
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

export async function renderInstructionFileBlock(
  harness: string,
  skills: PublicSkill[],
  context?: SyncContext,
  skillsLocation?: string,
): Promise<string> {
  const enriched = await enrichSkills(skills)
  const guidance = buildPortableInstruction({ harness, ...(skillsLocation ? { skillsLocation } : {}) })
  const body = [guidance, '', renderSkillsText(enriched)].join('\n').trim()
  return renderManagedBlock(context, body)
}

export function skillsDirFor(instructionsFile: string): string {
  return path.join(path.dirname(instructionsFile), 'skills')
}

export async function mirrorInstructionFile(
  target: string,
  harness: string,
  skills: PublicSkill[],
  context?: SyncContext,
): Promise<{ count: number; skipped: number }> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const skillsDir = skillsDirFor(target)
  const folder = await mirrorAsSkillFolders(skillsDir, skills)
  const block = await renderInstructionFileBlock(harness, skills, context, skillsDir)
  await preserveHarnessSkillEdits(target, harness)
  await injectManagedBlock(target, block)
  if (context) await writeManagedSyncState(target, context)
  await writeLastExtraHash(target, block)
  return { count: skills.length, skipped: folder.skipped }
}

export async function cleanupInstructionFileSkills(target: string): Promise<void> {
  const skillsDir = skillsDirFor(target)
  const manifest = await readManifest(skillsDir)
  await Promise.all(
    manifest.skills
      .filter(name => isValidSegment(name))
      .map(name => fs.rm(path.join(skillsDir, name), { recursive: true, force: true }).catch(() => {})),
  )
  await fs.rm(path.join(skillsDir, MANIFEST_FILE), { force: true }).catch(() => {})
}

export type InstructionFileAdapterOptions = {
  name: string
  description: string
  filePath: () => string
  detect: () => Promise<boolean>
  ensureDir?: () => string
}

export function makeInstructionFileAdapter(opts: InstructionFileAdapterOptions): SyncAdapter {
  const file = opts.filePath
  return {
    name: opts.name,
    description: opts.description,
    capabilities: { instructionFile: true },
    async detect(): Promise<boolean> {
      return opts.detect()
    },
    async readManaged(): Promise<ManagedRead | null> {
      return readManagedContext(file())
    },
    managedFilePaths(): string[] {
      return [file()]
    },
    instructionFilePath(): string {
      return file()
    },
    async bootstrap(): Promise<string[]> {
      const target = file()
      await fs.mkdir(opts.ensureDir ? opts.ensureDir() : path.dirname(target), { recursive: true })
      const block = renderManagedBlock(undefined, buildPortableInstruction({ harness: opts.name, skillsLocation: skillsDirFor(target) }))
      await injectManagedBlock(target, block)
      return [`${opts.name}: wrote bootstrap instructions to ${target}`]
    },
    async cleanup(): Promise<void> {
      await cleanupInstructionFileSkills(file())
    },
    async mirror(skills: PublicSkill[], context?: SyncContext): Promise<{ count: number; skipped: number }> {
      if (opts.ensureDir) await fs.mkdir(opts.ensureDir(), { recursive: true })
      return mirrorInstructionFile(file(), opts.name, skills, context)
    },
  }
}
