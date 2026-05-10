import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_RECORD_KEYS,
  buildAgentEnsRecords,
  changedRecords,
  diffRecords,
  formatRecordValue,
  recordsFromTextMap,
} from '../../../src/identity/ens/agentRecords.js'

test('diffRecords flags only fields that change', () => {
  const current = { token: 'a', profile: 'ipfs://x' }
  const next = { token: 'a', profile: 'ipfs://y' }
  const diffs = diffRecords(current, next)
  const byField = Object.fromEntries(diffs.map(d => [d.field, d]))
  assert.equal(byField.token!.changed, false)
  assert.equal(byField.profile!.changed, true)
})

test('changedRecords returns changed public keys only', () => {
  const current = { token: 'a', profile: 'ipfs://x' }
  const next = { token: 'a', profile: 'ipfs://y' }
  const out = changedRecords(current, next)
  assert.equal(Object.keys(out).length, 1)
  assert.equal(out[AGENT_RECORD_KEYS.profile], 'ipfs://y')
})

test('recordsFromTextMap maps known ENS text keys to agent record fields', () => {
  const text = {
    [AGENT_RECORD_KEYS.token]: 'eip155:1:0x1:42',
    [AGENT_RECORD_KEYS.profile]: 'ipfs://abc',
  }
  const records = recordsFromTextMap(text)
  assert.equal(records.token, 'eip155:1:0x1:42')
  assert.equal(records.profile, 'ipfs://abc')
})

test('buildAgentEnsRecords formats public token and profile records only', () => {
  const records = buildAgentEnsRecords({
    chainId: 1,
    identityRegistryAddress: '0xABCDef0000000000000000000000000000000001',
    agentId: '42',
    agentCardCid: 'bafkreiabc',
  })
  assert.equal(records.token, 'eip155:1:0xabcdef0000000000000000000000000000000001:42')
  assert.equal(records.profile, 'ipfs://bafkreiabc')
})

test('formatRecordValue truncates IPFS CIDs for display', () => {
  assert.equal(formatRecordValue('profile', 'ipfs://bafkreiabcdefghijklmnop'), 'ipfs://bafkreiabc...klmnop')
  assert.equal(formatRecordValue('profile', 'ipfs://short'), 'ipfs://short')
  assert.equal(formatRecordValue('token', 'eip155:1:0x1:42'), 'eip155:1:0x1:42')
  assert.equal(formatRecordValue('profile', ''), '')
})

test('AGENT_RECORD_KEYS exposes only the structural ethagent records', () => {
  assert.deepEqual(Object.keys(AGENT_RECORD_KEYS).sort(), ['profile', 'token'])
  assert.equal(AGENT_RECORD_KEYS.token, 'org.ethagent.token')
  assert.equal(AGENT_RECORD_KEYS.profile, 'org.ethagent.profile')
})
