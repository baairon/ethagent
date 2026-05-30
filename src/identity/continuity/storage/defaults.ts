import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityAgentSnapshot, ContinuityFiles } from '../envelope.js'
import { createAgentCard, defaultPublicSkillsProfile, serializeAgentCard } from '../publicSkills.js'
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

export function defaultContinuityFiles(identity: EthagentIdentity, _now = new Date()): ContinuityFiles {
  const owner = identity.ownerAddress ?? identity.address
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
      'Stable identity, voice, and collaboration defaults this agent carries across sessions and models. Replace these prompts with durable instructions.',
      '',
      '- Role: what this agent is and the kind of work it should be trusted with.',
      '- Voice: how it should sound when helping you.',
      '- Collaboration style: how it should plan, ask questions, and present tradeoffs.',
      '',
      '## Principles',
      '',
      'Owner-approved defaults for repeated decisions. Keep these durable, specific, and easy to apply.',
      '',
      '- Decision rule: how the agent should choose when there are tradeoffs.',
      '- Engineering standard: what quality bar it should preserve.',
      '- Escalation rule: when it should stop and ask.',
      '',
      '## Boundaries',
      '',
      'Private limits and hard constraints. These override task-level convenience.',
      '',
      '- Never store seed phrases, private keys, raw wallet signatures, or API keys.',
      '- Ask for explicit approval before destructive operations.',
      '- Public capabilities belong in skill folders; keep private persona and limits here.',
      '',
    ].join('\n'),
    'MEMORY.md': [
      '# MEMORY.md',
      '',
      identityBlock,
      '',
      '## Durable User Preferences',
      '',
      'Long-lived owner preferences that survive sessions and model switches. Replace these prompts with stable facts.',
      '',
      '- Name and aliases:',
      '- Communication preferences:',
      '- Tooling and workflow:',
      '',
      '## Project Context',
      '',
      'Stable facts about active projects, repos, and conventions. Add dates for time-sensitive notes.',
      '',
      '### <project-name>',
      '',
      '- Repository:',
      '- Stack:',
      '- Conventions:',
      '- Active workstream: <YYYY-MM-DD summary>',
      '',
      '## Boundaries',
      '',
      'Never store seed phrases, private keys, raw wallet signatures, or API keys.',
      'Public capabilities belong in skill folders; keep private user and project facts here.',
      '',
    ].join('\n'),
  }
}

export function defaultAgentCardJson(identity: EthagentIdentity): string {
  return serializeAgentCard(createAgentCard(defaultPublicSkillsProfile(identity)))
}
