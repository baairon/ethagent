import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createContinuitySnapshotChallenge,
  createContinuitySnapshotEnvelope,
  normalizeContinuitySkills,
  parseContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
} from '../../../src/identity/continuity/envelope.js'
import { continuityPayloadFromArgs, normalizeContinuityPayload } from '../../../src/identity/continuity/payloadNormalization.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../../../src/identity/crypto/eth.js'

test('continuity snapshot round-trips an optional private skills tree', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const files = {
    'SOUL.md': '# soul\n',
    'MEMORY.md': '# memory\n',
  }
  const skills = {
    'git-commit/SKILL.md': '---\nname: git-commit\nvisibility: public\n---\n\nbody\n',
    'writing-obit/SKILL.md': '---\nname: writing-obit\nvisibility: private\n---\n\nbody\n',
    'writing-obit/references/api.md': '# api\n',
  }

  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 1, agentId: '7' },
      files,
      skills,
      transcript: [],
      state: {},
    },
  })
  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signature,
  })

  assert.deepEqual(restored.files, files)
  assert.deepEqual(restored.skills, skills)
})

test('continuity snapshot without skills produces no skills key in restored payload', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))

  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 1, agentId: '7' },
      files: { 'SOUL.md': '# s\n', 'MEMORY.md': '# m\n' },
      transcript: [],
      state: {},
    },
  })
  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signature,
  })

  assert.equal(restored.skills, undefined)
})

test('serialized snapshot envelope is byte-identical for empty-skills callers (legacy compat)', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const baseArgs = {
    ownerAddress,
    walletSignature: signature,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 1, agentId: '7' },
      files: { 'SOUL.md': '# s\n', 'MEMORY.md': '# m\n' },
      transcript: [],
      state: {},
    },
  }
  const envelopeNoSkills = createContinuitySnapshotEnvelope(baseArgs)
  const envelopeEmptySkills = createContinuitySnapshotEnvelope({ ...baseArgs, payload: { ...baseArgs.payload, skills: {} } })

  const a = restoreContinuitySnapshotEnvelope({ envelope: envelopeNoSkills, walletSignature: signature })
  const b = restoreContinuitySnapshotEnvelope({ envelope: envelopeEmptySkills, walletSignature: signature })
  assert.equal(a.skills, undefined)
  assert.equal(b.skills, undefined)
})

test('normalizeContinuitySkills rejects unsafe keys', () => {
  assert.equal(normalizeContinuitySkills(undefined), undefined)
  assert.equal(normalizeContinuitySkills(null), undefined)
  assert.equal(normalizeContinuitySkills('not-an-object'), undefined)
  assert.equal(normalizeContinuitySkills({}), undefined)
  assert.equal(normalizeContinuitySkills({ '/abs/SKILL.md': 'x' }), undefined)
  assert.equal(normalizeContinuitySkills({ '../etc/SKILL.md': 'x' }), undefined)
  assert.equal(normalizeContinuitySkills({ 'no-skill': 'x' }), undefined)
  assert.equal(normalizeContinuitySkills({ 'cat/SKILL.md': 123 as unknown as string }), undefined)
  const flat = normalizeContinuitySkills({ 'name/SKILL.md': 'body' })
  assert.deepEqual(flat, { 'name/SKILL.md': 'body' })
  const upgradedNested = normalizeContinuitySkills({ 'cat/name/SKILL.md': 'body' })
  assert.deepEqual(upgradedNested, { 'cat-name/SKILL.md': 'body' })
  const upgradedLegacyFlat = normalizeContinuitySkills({ 'cat/name.md': 'body' })
  assert.deepEqual(upgradedLegacyFlat, { 'cat-name/SKILL.md': 'body' })
})

test('normalizeContinuitySkills keeps every file of a tree past 500 entries', () => {
  assert.equal(Object.keys(normalizeContinuitySkills(skillTree(600)) ?? {}).length, 600)
})

test('a payload is version 1 up to 500 skill files and version 2 past that, and only those two are read', () => {
  const payloadWith = (skillFiles: number) => continuityPayloadFromArgs({
    ownerAddress: '0x0000000000000000000000000000000000000001',
    createdAt: new Date(0).toISOString(),
    payload: {
      agent: {},
      files: { 'SOUL.md': '# s\n', 'MEMORY.md': '# m\n' },
      skills: skillTree(skillFiles),
      transcript: [],
      state: {},
    },
  })
  const v1 = payloadWith(500)
  const v2 = payloadWith(501)
  assert.equal(v1.version, 1)
  assert.equal(v2.version, 2)
  assert.equal(normalizeContinuityPayload(v1).version, 1)
  assert.equal(normalizeContinuityPayload(v2).version, 2)
  assert.throws(() => normalizeContinuityPayload({ ...v1, version: 3 }), /payload version is invalid/)
})

test('parseContinuitySnapshotEnvelope ignores unknown payload extensions on restore', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 1, agentId: '7' },
      files: { 'SOUL.md': '# s\n', 'MEMORY.md': '# m\n' },
      transcript: [],
      state: {},
    },
  })
  const reparsed = parseContinuitySnapshotEnvelope(serializeContinuitySnapshotEnvelope(envelope))
  const restored = restoreContinuitySnapshotEnvelope({
    envelope: reparsed,
    walletSignature: signature,
  })
  assert.deepEqual(restored.files, { 'SOUL.md': '# s\n', 'MEMORY.md': '# m\n' })
})

function skillTree(files: number): Record<string, string> {
  const tree: Record<string, string> = { 'big/SKILL.md': 'body' }
  for (let i = 1; i < files; i++) tree[`big/f${i}.md`] = 'x'
  return tree
}
