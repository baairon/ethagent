import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityAgentSnapshot, ContinuityFiles } from '../envelope.js'
import { defaultPublicSkillsProfile, renderPublicSkillsJson } from '../publicSkills.js'
import { renderPrivateIdentityBlock } from './markdown.js'

export function continuityAgentSnapshot(identity: EthagentIdentity): ContinuityAgentSnapshot {
  const state = identity.state ?? {}
  return {
    ...(identity.chainId ? { chainId: identity.chainId } : {}),
    ...(identity.identityRegistryAddress ? { identityRegistryAddress: identity.identityRegistryAddress } : {}),
    ...(identity.agentId ? { agentId: identity.agentId } : {}),
    ...(identity.agentUri ? { agentUri: identity.agentUri } : {}),
    ...(identity.metadataCid ? { metadataCid: identity.metadataCid } : {}),
    ...(typeof state.name === 'string' ? { name: state.name } : {}),
    ...(typeof state.description === 'string' ? { description: state.description } : {}),
  }
}

export function defaultContinuityFiles(identity: EthagentIdentity, now = new Date()): ContinuityFiles {
  const owner = identity.ownerAddress ?? identity.address
  const created = now.toISOString().slice(0, 10)
  const identityBlock = renderPrivateIdentityBlock({
    owner,
    token: identity.agentId ? `#${identity.agentId}` : 'pending registration',
    chainId: identity.chainId ? identity.chainId.toString() : 'unknown',
    registry: identity.identityRegistryAddress ?? 'unknown',
  })
  return {
    'SOUL.md': [
      '# SOUL.md',
      '',
      identityBlock,
      '',
      '## Persona',
      '',
      '- Describe the private agent persona, voice, and collaboration style.',
      '- Keep standing behavior that should survive model switches and device restores.',
      '- Prefer stable guidance over session-specific preferences.',
      '',
      '## Operating Principles',
      '',
      '- Record durable values, decision preferences, and owner-approved working principles.',
      '- Keep implementation-specific facts in MEMORY.md unless they define behavior.',
      '',
      '## Private Instructions',
      '',
      '- Keep owner-specific standing instructions in this file.',
      '- Do not share this file directly; save it via the Identity Hub encrypted snapshot.',
      '- Public capabilities belong in skills.json.',
      '',
      '## Boundaries',
      '',
      '- Record private behavioral limits and owner-approved constraints here.',
      '- Do not store seed phrases, private keys, raw wallet signatures, or API keys.',
      '- Do not place public delegation claims here; keep them in skills.json.',
      '',
      '## Maintenance Rules',
      '',
      '- Keep the generated Agent Identity block intact; edit owner-authored sections below it.',
      '- Do not duplicate the mutable public agent name here; it lives in the token URI and Agent Card.',
      '- Move factual project memory to MEMORY.md when it is not persona or instruction material.',
      '- Revise or remove stale guidance instead of accumulating contradictions.',
      '',
      '## Change Notes',
      '',
      '- Add dated notes when the persona or long-lived private guidance changes.',
      '',
      `Created: ${created}`,
    ].join('\n') + '\n',
    'MEMORY.md': [
      '# MEMORY.md',
      '',
      identityBlock,
      '',
      '## Durable User Preferences',
      '',
      '- Add long-lived owner preferences that should survive across sessions and model switches.',
      '',
      '## Project Context',
      '',
      '- Add stable project facts, repo conventions, and active workstreams.',
      '',
      '## Decisions and Rationale',
      '',
      '- Record important decisions and why they were made.',
      '',
      '## Facts to Revalidate',
      '',
      '- Add time-sensitive facts that should be checked before reuse, with dates or source context when available.',
      '',
      '## Maintenance Rules',
      '',
      '- Prefer stable facts, preferences, and decisions over chat transcripts.',
      '- Do not duplicate the mutable public agent name here; it lives in the token URI and Agent Card.',
      '- Add dates or source context when a note may become stale or environment-specific.',
      '- Remove or rewrite stale memory instead of accumulating contradictions.',
      '',
      '## Boundaries',
      '',
      '- Do not store seed phrases, private keys, raw wallet signatures, or API keys.',
      '- Do not store secrets unless the user explicitly asks and the risk is clear.',
      '- Keep public capabilities in skills.json.',
      '',
      `Created: ${created}`,
    ].join('\n') + '\n',
  }
}

export function defaultPublicSkillsJson(identity: EthagentIdentity): string {
  return renderPublicSkillsJson(defaultPublicSkillsProfile(identity))
}
