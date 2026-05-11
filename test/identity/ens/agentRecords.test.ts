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
  const current = { token: 'a' }
  const next = { token: 'b' }
  const diffs = diffRecords(current, next)
  const byField = Object.fromEntries(diffs.map(d => [d.field, d]))
  assert.equal(byField.token!.changed, true)
})

test('diffRecords reports unchanged when token matches', () => {
  const current = { token: 'a' }
  const next = { token: 'a' }
  const diffs = diffRecords(current, next)
  const byField = Object.fromEntries(diffs.map(d => [d.field, d]))
  assert.equal(byField.token!.changed, false)
})

test('changedRecords returns changed public keys only', () => {
  const current = { token: 'a' }
  const next = { token: 'b' }
  const out = changedRecords(current, next)
  assert.equal(Object.keys(out).length, 1)
  assert.equal(out[AGENT_RECORD_KEYS.token], 'b')
})

test('recordsFromTextMap maps known ENS text keys to agent record fields', () => {
  const text = {
    [AGENT_RECORD_KEYS.token]: 'eip155:1:0x1:42',
  }
  const records = recordsFromTextMap(text)
  assert.equal(records.token, 'eip155:1:0x1:42')
})

test('buildAgentEnsRecords formats the token record', () => {
  const records = buildAgentEnsRecords({
    chainId: 1,
    identityRegistryAddress: '0xABCDef0000000000000000000000000000000001',
    agentId: '42',
  })
  assert.equal(records.token, 'eip155:1:0xabcdef0000000000000000000000000000000001:42')
})

test('formatRecordValue returns values verbatim', () => {
  assert.equal(formatRecordValue('token', 'eip155:1:0x1:42'), 'eip155:1:0x1:42')
  assert.equal(formatRecordValue('token', ''), '')
})

test('AGENT_RECORD_KEYS exposes only the token record', () => {
  assert.deepEqual(Object.keys(AGENT_RECORD_KEYS).sort(), ['token'])
  assert.equal(AGENT_RECORD_KEYS.token, 'org.ethagent.token')
})
