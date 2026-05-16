import type { EthagentIdentity } from '../../storage/config.js'
import type { SkillIndexEntry } from './skills/types.js'
import { identityOwnerAddress } from '../hub/custody/state.js'
import { toChecksumAddress } from '../crypto/eth.js'

type PublicSkill = {
  id: string
  name: string
  description: string
  inputModes: string[]
  outputModes: string[]
}

type PublicSkillsProfile = {
  name: string
  description: string
  version: string
  agentWallet?: string
  imageUrl?: string
  skills: PublicSkill[]
}

type AgentCard = {
  name: string
  description: string
  version: string
  protocolVersion: string
  url?: string
  image?: string
  defaultInputModes: string[]
  defaultOutputModes: string[]
  capabilities: {
    streaming: boolean
    pushNotifications: boolean
  }
  producer: { name: string; url: string }
  agent_wallet?: string
  skills: Array<{
    id: string
    name: string
    description: string
    inputModes: string[]
    outputModes: string[]
  }>
}

const ETHAGENT_PRODUCER = {
  name: 'ethagent',
  url: 'https://github.com/baairon/ethagent',
} as const

export function defaultPublicSkillsProfile(identity: EthagentIdentity): PublicSkillsProfile {
  const state = identity.state ?? {}
  const name = typeof state.name === 'string' && state.name.trim()
    ? state.name.trim()
    : identity.agentId ? `ethagent #${identity.agentId}` : 'ethagent'
  const description = typeof state.description === 'string' && state.description.trim()
    ? state.description.trim()
    : 'privacy-first AI agent with a portable Ethereum identity'
  const imageUrl = typeof state.imageUrl === 'string' && state.imageUrl.trim()
    ? state.imageUrl.trim()
    : undefined
  const ownerAddress = identityOwnerAddress(identity)
  const agentWallet = ownerAddress ? toChecksumAddress(ownerAddress) : ''
  return {
    name,
    description,
    version: '1.0.0',
    ...(agentWallet ? { agentWallet } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    skills: [
      {
        id: 'software-engineering',
        name: 'Software engineering',
        description: 'Read code, plan implementations, debug failures, refactor safely, and run focused tests.',
        inputModes: ['text/markdown'],
        outputModes: ['text/markdown'],
      },
      {
        id: 'workspace-tools',
        name: 'Workspace tools',
        description: 'Use permissioned local file, shell, clipboard, and MCP tools for project work.',
        inputModes: ['text/markdown'],
        outputModes: ['text/markdown', 'application/json'],
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

export function appendPublicSkillEntries(
  profile: PublicSkillsProfile,
  entries: readonly SkillIndexEntry[],
): PublicSkillsProfile {
  if (entries.length === 0) return profile
  const baselineIds = new Set(profile.skills.map(skill => skill.id))
  const appended: PublicSkill[] = []
  const usedIds = new Set(baselineIds)
  for (const entry of entries) {
    if (entry.visibility !== 'public') continue
    const id = uniqueSkillId(entry.name, usedIds)
    usedIds.add(id)
    appended.push({
      id,
      name: entry.displayName ?? entry.name,
      description: entry.description || entry.name,
      inputModes: ['text/markdown'],
      outputModes: ['text/markdown'],
    })
  }
  if (appended.length === 0) return profile
  return {
    ...profile,
    skills: [...profile.skills, ...appended],
  }
}

function uniqueSkillId(base: string, used: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
  if (!used.has(slug)) return slug
  let i = 2
  while (used.has(`${slug}-${i}`)) i++
  return `${slug}-${i}`
}

export function renderPublicSkillsJson(profile: PublicSkillsProfile): string {
  const inputModes = unique(profile.skills.flatMap(skill => skill.inputModes))
  const outputModes = unique(profile.skills.flatMap(skill => skill.outputModes))
  const summary = {
    schema: 'ethagent.public-skills.v1',
    producer: ETHAGENT_PRODUCER,
    ...(profile.agentWallet ? { agent_wallet: profile.agentWallet } : {}),
    visibility: 'public',
    name: profile.name,
    description: profile.description,
    version: profile.version,
    ...(profile.imageUrl ? { imageUrl: profile.imageUrl } : {}),
    inputModes,
    outputModes,
    boundary: 'Public discovery only. This is not executable code, private memory, or a skill installation manifest.',
    capabilities: {
      softwareEngineering: true,
      workspaceTools: 'permissioned',
      mcp: true,
      streaming: true,
      ethereumIdentity: 'ERC-8004',
      encryptedContinuity: true,
    },
    delegation: {
      bestFor: [
        'code reading',
        'implementation planning',
        'debugging',
        'refactors',
        'tests',
        'workspace automation',
      ],
      requiresApprovalFor: [
        'workspace edits',
        'shell commands',
        'private continuity changes',
      ],
    },
    privacy: {
      publicOnly: true,
      includesPrivateMemory: false,
      includesExecutableCode: false,
      includesSecrets: false,
    },
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

export function createAgentCard(profile: PublicSkillsProfile, url?: string): AgentCard {
  const inputModes = unique(profile.skills.flatMap(skill => skill.inputModes))
  const outputModes = unique(profile.skills.flatMap(skill => skill.outputModes))
  return {
    name: profile.name,
    description: profile.description,
    version: profile.version,
    ...(profile.agentWallet ? { agent_wallet: profile.agentWallet } : {}),
    protocolVersion: '0.2.6',
    ...(url ? { url } : {}),
    ...(profile.imageUrl ? { image: profile.imageUrl } : {}),
    defaultInputModes: inputModes.length ? inputModes : ['text/markdown'],
    defaultOutputModes: outputModes.length ? outputModes : ['text/markdown'],
    capabilities: {
      streaming: true,
      pushNotifications: false,
    },
    producer: ETHAGENT_PRODUCER,
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
