import { atomicWriteText } from '../../../storage/atomicWrite.js'
import type { EthagentIdentity } from '../../../storage/config.js'
import {
  appendPublicSkillEntries,
  createAgentCard,
  defaultPublicSkillsProfile,
  serializeAgentCard,
} from '../publicSkills.js'
import { ensureContinuityVault, ensureTrailingNewline, readOrDefault } from '../storage/files.js'
import { listSkills } from './loadSkills.js'
import { isDraftScaffold } from './scaffold.js'
import type { SkillIndexEntry } from './types.js'

export async function derivePublicSkillEntries(identity: EthagentIdentity): Promise<SkillIndexEntry[]> {
  return publicSkillEntries(await listSkills(identity))
}

function publicSkillEntries(entries: readonly SkillIndexEntry[]): SkillIndexEntry[] {
  return entries.filter(entry => entry.visibility === 'public' && !isDraftScaffold(entry))
}

export function renderAgentCardJson(identity: EthagentIdentity, entries: readonly SkillIndexEntry[]): string {
  const profile = appendPublicSkillEntries(defaultPublicSkillsProfile(identity), publicSkillEntries(entries))
  return serializeAgentCard(createAgentCard(profile))
}

export async function renderAgentCardJsonForIdentity(identity: EthagentIdentity): Promise<string> {
  return renderAgentCardJson(identity, await listSkills(identity))
}

export function packedAgentCard(current: string, next: string): { packed: string; stale: boolean } {
  const stale = !(current === ensureTrailingNewline(next) || current === next)
  return { packed: stale ? next : current, stale }
}

export async function syncAgentCardManifest(identity: EthagentIdentity): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  const next = await renderAgentCardJsonForIdentity(identity)
  const current = await readOrDefault(ref.agentCardPath, '')
  const { packed, stale } = packedAgentCard(current, next)
  if (!stale) return packed
  await atomicWriteText(ref.agentCardPath, ensureTrailingNewline(next), { mode: 0o644 })
  return packed
}
