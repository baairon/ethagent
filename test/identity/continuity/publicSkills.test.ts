import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAgentCard,
  defaultPublicSkillsProfile,
  renderPublicSkillsJson,
  serializeAgentCard,
} from '../../../src/identity/continuity/publicSkills.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  agentId: '42',
  state: {
    name: 'public agent',
    description: 'public description',
    imageUrl: 'ipfs://bafy-agent-image',
    memory: { secret: 'private memory marker' },
  },
}

test('public skills json contains public capabilities only', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const jsonContent = renderPublicSkillsJson(profile)
  const parsed = JSON.parse(jsonContent)

  assert.equal(parsed.schema, 'ethagent.public-skills.v1')
  assert.equal(parsed.visibility, 'public')
  assert.equal(parsed.boundary, 'Public discovery only. This is not executable code, private memory, or a skill installation manifest.')
  assert.equal(parsed.privacy.publicOnly, true)
  assert.equal(parsed.privacy.includesPrivateMemory, false)
  assert.equal(parsed.privacy.includesSecrets, false)
  assert.ok(parsed.skills.some((s: any) => s.name === 'Software engineering'))
  assert.equal(jsonContent.includes('private memory marker'), false)
})

test('public skills json exposes a parseable agent summary for other agents', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const jsonContent = renderPublicSkillsJson(profile)
  const summary = JSON.parse(jsonContent) as {
    schema?: string
    name?: string
    description?: string
    capabilities?: { workspaceTools?: string; mcp?: boolean; ethereumIdentity?: string }
    delegation?: { bestFor?: string[]; requiresApprovalFor?: string[] }
    skills?: Array<{ id: string; inputModes: string[]; outputModes: string[] }>
  }

  assert.equal(summary.schema, 'ethagent.public-skills.v1')
  assert.equal(summary.name, 'public agent')
  assert.equal(summary.description, 'public description')
  assert.equal((summary as { imageUrl?: string }).imageUrl, 'ipfs://bafy-agent-image')
  assert.equal(summary.capabilities?.workspaceTools, 'permissioned')
  assert.equal(summary.capabilities?.mcp, true)
  assert.equal(summary.capabilities?.ethereumIdentity, 'ERC-8004')
  assert.ok(summary.delegation?.bestFor?.includes('tests'))
  assert.ok(summary.delegation?.requiresApprovalFor?.includes('workspace edits'))
  assert.ok(summary.skills?.some(skill => skill.id === 'software-engineering'))
  assert.ok(summary.skills?.every(skill => Array.isArray(skill.inputModes) && Array.isArray(skill.outputModes)))
})

test('agent card serializes A2A-style public skills without private continuity', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const card = createAgentCard(profile, 'ipfs://bafy-endpoint')
  const serialized = serializeAgentCard(card)

  assert.equal(card.protocolVersion, '0.2.6')
  assert.equal(card.url, 'ipfs://bafy-endpoint')
  assert.equal(card.image, 'ipfs://bafy-agent-image')
  assert.equal('iconUrl' in card, false)
  assert.ok(card.skills.some(skill => skill.id === 'software-engineering'))
  assert.equal(serialized.includes('private memory marker'), false)
  assert.match(serialized, /"defaultInputModes"/)
})

test('agent card omits placeholder URL when no endpoint is supplied', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const card = createAgentCard(profile)
  const serialized = serializeAgentCard(card)

  assert.equal(card.url, undefined)
  assert.equal(serialized.includes('pending-agent-endpoint'), false)
  assert.equal('iconUrl' in card, false)
})
