import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_TOKEN_RECORD_KEY,
  buildAgentEnsRecords,
  buildEnsip25Key,
  changedRecords,
  clearedRecords,
  diffRecords,
  recordsFromTextMap,
} from '../../../src/identity/ens/agentRecords.js'

const registry = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const ensip25KeyForAgent42 = 'agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][42]'
const tokenValueForAgent42 = 'eip155:1:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:42'

test('buildEnsip25Key matches the spec example for mainnet', () => {
  const key = buildEnsip25Key({
    chainId: 1,
    identityRegistryAddress: registry,
    agentId: 42n,
  })
  assert.equal(key, ensip25KeyForAgent42)
})

test('buildEnsip25Key rejects agentIds containing brackets', () => {
  assert.throws(() => buildEnsip25Key({
    chainId: 1,
    identityRegistryAddress: registry,
    agentId: '42[bad]',
  }), /square brackets/)
})

test('buildAgentEnsRecords writes the ENSIP-25 attestation and the discovery hint', () => {
  const records = buildAgentEnsRecords({
    chainId: 1,
    identityRegistryAddress: registry,
    agentId: '42',
  })
  assert.deepEqual(records, {
    [ensip25KeyForAgent42]: '1',
    [AGENT_TOKEN_RECORD_KEY]: tokenValueForAgent42,
  })
})

test('buildAgentEnsRecords yields an empty map when no agentId is set', () => {
  const records = buildAgentEnsRecords({
    chainId: 1,
    identityRegistryAddress: registry,
    agentId: undefined,
  })
  assert.deepEqual(records, {})
})

test('diffRecords reports only changed keys, regardless of which side defines them', () => {
  const current = { [ensip25KeyForAgent42]: '1', 'other-key': 'a' }
  const next = { [ensip25KeyForAgent42]: '1', 'other-key': 'b' }
  const diffs = diffRecords(current, next)
  const byKey = Object.fromEntries(diffs.map(d => [d.key, d]))
  assert.equal(byKey[ensip25KeyForAgent42]!.changed, false)
  assert.equal(byKey['other-key']!.changed, true)
})

test('changedRecords returns only the keys whose values changed', () => {
  const current = { [ensip25KeyForAgent42]: '' }
  const next = { [ensip25KeyForAgent42]: '1' }
  const out = changedRecords(current, next)
  assert.deepEqual(out, { [ensip25KeyForAgent42]: '1' })
})

test('clearedRecords produces empty-string entries for each existing key', () => {
  const current = { [ensip25KeyForAgent42]: '1', extra: 'x' }
  assert.deepEqual(clearedRecords(current), { [ensip25KeyForAgent42]: '', extra: '' })
})

test('recordsFromTextMap drops empty values', () => {
  const text = { [ensip25KeyForAgent42]: '1', empty: '' }
  assert.deepEqual(recordsFromTextMap(text), { [ensip25KeyForAgent42]: '1' })
})
