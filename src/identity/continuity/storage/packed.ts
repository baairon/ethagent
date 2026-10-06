import fs from 'node:fs/promises'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles, ContinuitySkillsTree } from '../envelope.js'
import { normalizeContinuitySkills } from '../skillsNormalization.js'
import { listSkillEntriesView, readSkillsTreeView, type SkillSkip } from '../skills/loadSkills.js'
import { packedAgentCard, renderAgentCardJson } from '../skills/publicSkillsSync.js'
import { defaultContinuityFiles } from './defaults.js'
import { readOrDefault, statIfExists } from './files.js'
import { continuityVaultRef } from './paths.js'

export type PackedSources = {
  privateFiles: ContinuityFiles
  agentCard?: string
  skills?: ContinuitySkillsTree
}

export type PackedWarning = 'legacy-skill-layout' | 'agent-card-stale'

export type PackedWorkingView = {
  ready: boolean
  files: Record<string, string>
  sources: { privateFiles: ContinuityFiles; agentCard: string; skills: ContinuitySkillsTree }
  lossy: string[]
  skipped: SkillSkip[]
  rekeyed: string[]
  normalizesOnSave: string[]
  pendingPull: string[]
  warnings: PackedWarning[]
}

export const AGENT_CARD_PATH = 'agent-card.json'
export const SKILLS_PREFIX = 'skills/'

export function packedFileMap(sources: PackedSources): Record<string, string> {
  const files: Record<string, string> = {
    'SOUL.md': sources.privateFiles['SOUL.md'],
    'MEMORY.md': sources.privateFiles['MEMORY.md'],
  }
  if (sources.agentCard !== undefined) files[AGENT_CARD_PATH] = sources.agentCard
  const skills = sources.skills && Object.keys(sources.skills).length > 0
    ? normalizeContinuitySkills(sources.skills) ?? {}
    : {}
  for (const [key, value] of Object.entries(skills)) files[`${SKILLS_PREFIX}${key}`] = value
  return files
}

export async function readPackedWorkingView(
  identity: EthagentIdentity,
  soulMemory?: { files: ContinuityFiles; pulled: string[] },
): Promise<PackedWorkingView> {
  const ref = continuityVaultRef(identity)
  const [soulStat, memoryStat] = await Promise.all([statIfExists(ref.soulPath), statIfExists(ref.memoryPath)])
  const defaults = defaultContinuityFiles(identity)
  const lossy: string[] = []
  const readText = async (file: string, label: string, fallback: string): Promise<string> => {
    const bytes = await fs.readFile(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    if (bytes === null) return fallback
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes)) lossy.push(label)
    return text
  }
  const diskFiles: ContinuityFiles = {
    'SOUL.md': await readText(ref.soulPath, 'SOUL.md', defaults['SOUL.md']),
    'MEMORY.md': await readText(ref.memoryPath, 'MEMORY.md', defaults['MEMORY.md']),
  }
  const privateFiles = soulMemory?.files ?? diskFiles
  const skillsView = await readSkillsTreeView(ref.skillsDir)
  const entries = await listSkillEntriesView(ref.skillsDir)
  const currentCard = await readOrDefault(ref.agentCardPath, '')
  const card = packedAgentCard(currentCard, renderAgentCardJson(identity, entries))
  const sources = { privateFiles, agentCard: card.packed, skills: skillsView.tree }
  const files = packedFileMap(sources)
  const rekeyed = Object.keys(skillsView.tree)
    .filter(key => files[`${SKILLS_PREFIX}${key}`] === undefined)
    .map(key => `${SKILLS_PREFIX}${key}`)
  const warnings: PackedWarning[] = []
  if (skillsView.legacyLayout) warnings.push('legacy-skill-layout')
  if (card.stale) warnings.push('agent-card-stale')
  return {
    ready: Boolean(soulStat && memoryStat),
    files,
    sources,
    lossy: [...lossy, ...skillsView.lossy.map(key => `${SKILLS_PREFIX}${key}`)],
    skipped: skillsView.skipped.map(skip => ({ ...skip, path: `${SKILLS_PREFIX}${skip.path}` })),
    rekeyed,
    normalizesOnSave: skillsView.normalizesOnSave.map(key => `${SKILLS_PREFIX}${key}`),
    pendingPull: soulMemory?.pulled ?? [],
    warnings,
  }
}
