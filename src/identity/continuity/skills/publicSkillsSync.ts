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
  const entries = await listSkills(identity)
  return entries.filter(entry => entry.visibility === 'public' && !isDraftScaffold(entry))
}

export async function renderAgentCardJsonForIdentity(identity: EthagentIdentity): Promise<string> {
  const publicEntries = await derivePublicSkillEntries(identity)
  const profile = appendPublicSkillEntries(defaultPublicSkillsProfile(identity), publicEntries)
  return serializeAgentCard(createAgentCard(profile))
}

export async function syncAgentCardManifest(identity: EthagentIdentity): Promise<string> {
  const ref = await ensureContinuityVault(identity)
  const next = await renderAgentCardJsonForIdentity(identity)
  const current = await readOrDefault(ref.agentCardPath, '')
  if (current === ensureTrailingNewline(next) || current === next) {
    return current
  }
  await atomicWriteText(ref.agentCardPath, ensureTrailingNewline(next), { mode: 0o644 })
  return next
}
