import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAgentCard,
  defaultPublicSkillsProfile,
  renderPublicSkillsMarkdown,
  serializeAgentCard,
} from '../src/identity/continuity/publicSkills.js'
import type { EthagentIdentity } from '../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  agentId: '42',
  state: {
    name: 'public agent',
    description: 'public description',
    memory: { secret: 'private memory marker' },
  },
}

test('public skills markdown contains public capabilities only', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const markdown = renderPublicSkillsMarkdown(profile)

  assert.match(markdown, /^# public agent Skills/)
  assert.match(markdown, /ethagent\.public-skills\.v1/)
  assert.match(markdown, /"visibility": "public"/)
  assert.match(markdown, /Software engineering/)
  assert.match(markdown, /Public discovery metadata only/)
  assert.match(markdown, /Private continuity lives in local SOUL\.md and MEMORY\.md files and encrypted snapshots/)
  assert.equal(markdown.includes('private memory marker'), false)
})

test('public skills markdown exposes a parseable agent summary for other agents', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const markdown = renderPublicSkillsMarkdown(profile)
  const match = markdown.match(/```json\n([\s\S]*?)\n```/)
  assert.ok(match)
  const summary = JSON.parse(match[1] ?? '{}') as {
    schema?: string
    name?: string
    description?: string
    skills?: Array<{ id: string; inputModes: string[]; outputModes: string[] }>
  }

  assert.equal(summary.schema, 'ethagent.public-skills.v1')
  assert.equal(summary.name, 'public agent')
  assert.equal(summary.description, 'public description')
  assert.ok(summary.skills?.some(skill => skill.id === 'software-engineering'))
  assert.ok(summary.skills?.every(skill => Array.isArray(skill.inputModes) && Array.isArray(skill.outputModes)))
})

test('agent card serializes A2A-style public skills without private continuity', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const card = createAgentCard(profile, 'ipfs://bafy-endpoint')
  const serialized = serializeAgentCard(card)

  assert.equal(card.protocolVersion, '0.2.6')
  assert.equal(card.url, 'ipfs://bafy-endpoint')
  assert.ok(card.skills.some(skill => skill.id === 'software-engineering'))
  assert.equal(serialized.includes('private memory marker'), false)
  assert.match(serialized, /"defaultInputModes"/)
})
