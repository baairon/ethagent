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
      'The standing voice, collaboration style, and behavior this agent keeps across sessions and models.',
      '',
      '- Voice: <e.g., direct, concise, no filler>',
      '- Tone: <e.g., warm but professional>',
      '- Communication style: <e.g., bullet lists for technical work, prose for narrative>',
      '',
      '## Principles',
      '',
      'Owner-approved working principles. Decisions that should be made the same way every time.',
      '',
      '- <principle: e.g., always confirm before destructive operations>',
      '- <principle: e.g., bias toward editing existing code over creating new files>',
      '- <principle: e.g., never hide errors, always surface them clearly>',
      '',
      '## Boundaries',
      '',
      'What this agent must never do, regardless of how it is asked.',
      '',
      '- <boundary: e.g., never bypass authentication or authorization checks>',
      '- <boundary: e.g., never commit secrets to source control>',
      '- Never store seed phrases, private keys, raw wallet signatures, or API keys.',
      '',
    ].join('\n'),
    'MEMORY.md': [
      '# MEMORY.md',
      '',
      identityBlock,
      '',
      '## Durable User Preferences',
      '',
      'Long-lived owner preferences that survive sessions and model switches. Capture how the user works.',
      '',
      '- Communication: <e.g., prefers concise summaries over walls of text>',
      '- Tooling: <e.g., VS Code, zsh, TypeScript over JavaScript>',
      '- Workflow: <e.g., reviews PRs in the morning, deploys on Fridays>',
      '',
      '## Project Context',
      '',
      'Stable facts about active projects, repos, and conventions. Add dates for time-sensitive notes.',
      '',
      '### <project-name>',
      '',
      '- Repository: <url or local path>',
      '- Stack: <languages, frameworks, key libraries>',
      '- Conventions: <e.g., conventional commits, semver, branch naming>',
      '- Active workstream: <YYYY-MM-DD what you are focused on>',
      '',
      '## Boundaries',
      '',
      'Never store seed phrases, private keys, raw wallet signatures, or API keys.',
      '',
    ].join('\n'),
  }
}

export function defaultPublicSkillsJson(identity: EthagentIdentity): string {
  return renderPublicSkillsJson(defaultPublicSkillsProfile(identity))
}
