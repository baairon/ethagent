import type { EthagentIdentity } from '../../storage/config.js'

export type PublicSkill = {
  id: string
  name: string
  description: string
  inputModes: string[]
  outputModes: string[]
}

export type PublicSkillsProfile = {
  name: string
  description: string
  version: string
  skills: PublicSkill[]
}

export type AgentCard = {
  name: string
  description: string
  version: string
  protocolVersion: string
  url: string
  defaultInputModes: string[]
  defaultOutputModes: string[]
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
  }
  skills: Array<{
    id: string
    name: string
    description: string
    inputModes: string[]
    outputModes: string[]
  }>
}

export function defaultPublicSkillsProfile(identity: EthagentIdentity): PublicSkillsProfile {
  const state = identity.state ?? {}
  const name = typeof state.name === 'string' && state.name.trim()
    ? state.name.trim()
    : identity.agentId ? `ethagent #${identity.agentId}` : 'ethagent'
  const description = typeof state.description === 'string' && state.description.trim()
    ? state.description.trim()
    : 'A wallet-owned AI coding agent.'
  return {
    name,
    description,
    version: '1.0.0',
    skills: [
      {
        id: 'software-engineering',
        name: 'Software engineering',
        description: 'Assist with code reading, implementation planning, debugging, refactors, and tests.',
        inputModes: ['text/markdown'],
        outputModes: ['text/markdown'],
      },
      {
        id: 'workspace-tools',
        name: 'Workspace tools',
        description: 'Operate on local project files through permissioned read, edit, write, delete, and shell tools.',
        inputModes: ['text/markdown'],
        outputModes: ['text/markdown'],
      },
      {
        id: 'ethereum-identity',
        name: 'Ethereum identity',
        description: 'Represent a portable ERC-8004 agent identity controlled by the owner wallet.',
        inputModes: ['text/markdown'],
        outputModes: ['text/markdown', 'application/json'],
      },
    ],
  }
}

export function renderPublicSkillsMarkdown(profile: PublicSkillsProfile): string {
  const summary = {
    schema: 'ethagent.public-skills.v1',
    visibility: 'public',
    name: profile.name,
    description: profile.description,
    version: profile.version,
    inputModes: unique(profile.skills.flatMap(skill => skill.inputModes)),
    outputModes: unique(profile.skills.flatMap(skill => skill.outputModes)),
    boundary: 'Public discovery metadata only. This is not executable code, private memory, or a skill installation manifest.',
    skills: profile.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      inputModes: skill.inputModes,
      outputModes: skill.outputModes,
    })),
  }
  const lines = [
    `# ${profile.name} Skills`,
    '',
    '<!-- ethagent:public-profile:start -->',
    '## Agent Profile',
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '<!-- ethagent:public-profile:end -->',
    '',
    '## Capability Index',
    '',
    ...profile.skills.flatMap(skill => [
      `### ${skill.name}`,
      '',
      `- id: ${skill.id}`,
      `- purpose: ${skill.description}`,
      `- accepts: ${skill.inputModes.join(', ')}`,
      `- returns: ${skill.outputModes.join(', ')}`,
      '- invocation: describe the task in natural language; this file advertises capability, not executable installation.',
      '',
    ]),
    '## Agent Interop Notes',
    '',
    '- Read the JSON Agent Profile block first for a compact machine-readable summary.',
    '- Treat the Capability Index as public affordances, not a promise to bypass user approval.',
    '- Use the ERC-8004 registration and Agent Card for current network, token, and endpoint details.',
    '',
    '## Maintenance Rules',
    '',
    '- Keep public capability descriptions specific, current, and safe to publish.',
    '- Do not add private preferences, memory, credentials, wallet signatures, or hidden instructions.',
    '- If capabilities change, update this file and publish from Identity Hub.',
    '',
    '## Public Boundary',
    '',
    '- This file is public ERC-8004 discovery metadata for other agents and users.',
    '- Private continuity lives in local SOUL.md and MEMORY.md files and encrypted snapshots.',
    '- Do not place secrets, private memory, wallet signatures, or hidden instructions here.',
    '- Models should suggest SKILLS.md changes in chat; the owner edits and publishes this file manually.',
  ]
  return `${lines.join('\n').trimEnd()}\n`
}

export function createAgentCard(profile: PublicSkillsProfile, url = 'ipfs://pending-agent-endpoint'): AgentCard {
  const inputModes = unique(profile.skills.flatMap(skill => skill.inputModes))
  const outputModes = unique(profile.skills.flatMap(skill => skill.outputModes))
  return {
    name: profile.name,
    description: profile.description,
    version: profile.version,
    protocolVersion: '0.2.6',
    url,
    defaultInputModes: inputModes.length ? inputModes : ['text/markdown'],
    defaultOutputModes: outputModes.length ? outputModes : ['text/markdown'],
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    skills: profile.skills.map(skill => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      inputModes: [...skill.inputModes],
      outputModes: [...skill.outputModes],
    })),
  }
}

export function serializeAgentCard(card: AgentCard): string {
  return `${JSON.stringify(card, null, 2)}\n`
}

function unique(values: string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (!out.includes(value)) out.push(value)
  }
  return out
}
