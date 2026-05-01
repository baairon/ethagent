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
  imageUrl?: string
  skills: PublicSkill[]
}

export type AgentCard = {
  name: string
  description: string
  version: string
  protocolVersion: string
  url: string
  image?: string
  iconUrl?: string
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
  const imageUrl = typeof state.imageUrl === 'string' && state.imageUrl.trim()
    ? state.imageUrl.trim()
    : undefined
  return {
    name,
    description,
    version: '1.0.0',
    ...(imageUrl ? { imageUrl } : {}),
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

export function renderPublicSkillsJson(profile: PublicSkillsProfile): string {
  const summary = {
    schema: 'ethagent.public-skills.v1',
    visibility: 'public',
    name: profile.name,
    description: profile.description,
    version: profile.version,
    ...(profile.imageUrl ? { imageUrl: profile.imageUrl } : {}),
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
  return `${JSON.stringify(summary, null, 2)}\n`
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
    ...(profile.imageUrl ? { image: profile.imageUrl, iconUrl: profile.imageUrl } : {}),
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
