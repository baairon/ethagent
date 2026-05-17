import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendPublicSkillEntries,
  createAgentCard,
  defaultPublicSkillsProfile,
  serializeAgentCard,
} from '../../../src/identity/continuity/publicSkills.js'
import type { SkillIndexEntry } from '../../../src/identity/continuity/skills/types.js'
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

test('agent card serializes A2A-style public skills without private continuity', () => {
  const profile = appendPublicSkillEntries(defaultPublicSkillsProfile(identity), [
    {
      name: 'public-skill',
      description: 'visible in card',
      visibility: 'public',
      relativePath: 'public-skill/SKILL.md',
      absolutePath: '/tmp/public-skill/SKILL.md',
    },
  ])
  const card = createAgentCard(profile, 'ipfs://bafy-endpoint')
  const serialized = serializeAgentCard(card)

  assert.equal(card.protocolVersion, '0.3.0')
  assert.equal(card.url, 'ipfs://bafy-endpoint')
  assert.equal(card.image, 'ipfs://bafy-agent-image')
  assert.equal('iconUrl' in card, false)
  assert.ok(card.skills.some(skill => skill.id === 'public-skill'))
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

test('agent card reflects identity name, description, and image', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const card = createAgentCard(profile)

  assert.equal(card.name, 'public agent')
  assert.equal(card.description, 'public description')
  assert.equal(card.image, 'ipfs://bafy-agent-image')
  assert.deepEqual(card.skills, [])
})

test('appendPublicSkillEntries hides private skills and surfaces only public', () => {
  const profile = defaultPublicSkillsProfile(identity)
  const entries: SkillIndexEntry[] = [
    {
      name: 'private-skill',
      description: 'kept hidden',
      visibility: 'private',
      relativePath: 'private-skill/SKILL.md',
      absolutePath: '/tmp/private-skill/SKILL.md',
    },
    {
      name: 'public-skill',
      description: 'in the manifest',
      visibility: 'public',
      relativePath: 'public-skill/SKILL.md',
      absolutePath: '/tmp/public-skill/SKILL.md',
    },
  ]
  const appended = appendPublicSkillEntries(profile, entries)
  const skillIds = appended.skills.map(s => s.id)
  assert.equal(skillIds.includes('private-skill'), false)
  assert.ok(skillIds.includes('public-skill'))
})
