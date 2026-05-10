import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_STATE_BACKUP_ENVELOPE_VERSION,
  assertAgentStateBackupOwner,
  createAgentStateBackupEnvelope,
  createAgentStateRecoveryChallenge,
  restoreAgentStateBackupEnvelope,
  serializeAgentStateBackupEnvelope,
} from '../../../src/identity/crypto/backupEnvelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../../../src/identity/crypto/eth.js'

test('agent state backup envelope encrypts and restores state with wallet signature only', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const state = { name: 'agent', memory: { project: 'ethagent' } }

  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: signature,
    state,
    createdAt: new Date(0).toISOString(),
  })
  const restored = restoreAgentStateBackupEnvelope({
    envelope,
    walletSignature: signature,
  })

  assert.equal(envelope.envelopeVersion, AGENT_STATE_BACKUP_ENVELOPE_VERSION)
  assert.deepEqual(restored.state, state)
  assert.equal(restored.ownerAddress, ownerAddress)
})

test('agent state recovery challenge is concise wallet-facing copy', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const challenge = createAgentStateRecoveryChallenge(ownerAddress)

  assert.match(challenge, /^Encrypted State Access\n/)
  assert.doesNotMatch(challenge, /^ethagent/i)
  assert.match(challenge, new RegExp(`Owner: ${ownerAddress}`))
  assert.match(challenge, /Action: authorize this wallet to unlock the encrypted agent backup/)
  assert.match(challenge, /Version: 1$/)
  assert.doesNotMatch(challenge, /purpose:/)
  assert.doesNotMatch(challenge, /portable ERC-8004 agent state/)
})

test('serialized agent state backup does not contain plaintext state or wallet signature', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: signature,
    state: { secretMemory: 'do not leak' },
  })
  const serialized = serializeAgentStateBackupEnvelope(envelope)

  assert.equal(serialized.includes('do not leak'), false)
  assert.equal(serialized.includes(signature), false)
})

test('non-owner wallet cannot decrypt prior owner agent state', () => {
  const ownerPrivateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerPrivateKey)
  const ownerSignature = signMessage(ownerPrivateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const otherSignature = signMessage(otherPrivateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: ownerSignature,
    state: { privateMemory: 'owner-only state' },
  })

  assert.throws(() => restoreAgentStateBackupEnvelope({
    envelope,
    walletSignature: otherSignature,
  }), /wallet signature/i)
})

test('agent state backup owner check blocks mismatched wallets before signing', () => {
  const ownerPrivateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerPrivateKey)
  const otherAddress = addressFromPrivateKey(otherPrivateKey)
  const ownerSignature = signMessage(ownerPrivateKey, createAgentStateRecoveryChallenge(ownerAddress))
  const envelope = createAgentStateBackupEnvelope({
    ownerAddress,
    walletSignature: ownerSignature,
    state: { privateMemory: 'owner-only state' },
  })

  assert.doesNotThrow(() => assertAgentStateBackupOwner(envelope, ownerAddress))
  assert.throws(() => assertAgentStateBackupOwner(envelope, otherAddress), /another wallet/)
})
