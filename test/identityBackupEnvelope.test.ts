import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_STATE_BACKUP_ENVELOPE_VERSION,
  assertAgentStateSnapshotOwner,
  createIdentityBackupEnvelope,
  createAgentStateBackupEnvelope,
  createAgentStateRecoveryChallenge,
  createRecoveryChallenge,
  restoreAgentStateBackupEnvelope,
  restoreIdentityBackupEnvelope,
  serializeAgentStateBackupEnvelope,
  serializeIdentityBackupEnvelope,
} from '../src/identity/backupEnvelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../src/identity/eth.js'

test('identity backup envelope encrypts and restores the same identity', () => {
  const privateKey = generatePrivateKey()
  const address = addressFromPrivateKey(privateKey)
  const passphrase = 'correct horse battery staple'
  const signature = signMessage(privateKey, createRecoveryChallenge(address))

  const envelope = createIdentityBackupEnvelope({
    privateKey,
    recoveryPassphrase: passphrase,
    walletSignature: signature,
    createdAt: new Date(0).toISOString(),
  })
  const restored = restoreIdentityBackupEnvelope({
    envelope,
    recoveryPassphrase: passphrase,
    walletSignature: signature,
  })

  assert.equal(restored.privateKey.toLowerCase(), privateKey.toLowerCase())
  assert.equal(restored.address, address)
})

test('identity backup restore fails with wrong passphrase', () => {
  const privateKey = generatePrivateKey()
  const address = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createRecoveryChallenge(address))
  const envelope = createIdentityBackupEnvelope({
    privateKey,
    recoveryPassphrase: 'correct passphrase',
    walletSignature: signature,
  })

  assert.throws(() => restoreIdentityBackupEnvelope({
    envelope,
    recoveryPassphrase: 'incorrect passphrase',
    walletSignature: signature,
  }), /credentials|decrypt/)
})

test('identity backup restore fails with wrong wallet signature', () => {
  const privateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const address = addressFromPrivateKey(privateKey)
  const passphrase = 'correct passphrase'
  const signature = signMessage(privateKey, createRecoveryChallenge(address))
  const wrongSignature = signMessage(otherPrivateKey, createRecoveryChallenge(address))
  const envelope = createIdentityBackupEnvelope({
    privateKey,
    recoveryPassphrase: passphrase,
    walletSignature: signature,
  })

  assert.throws(() => restoreIdentityBackupEnvelope({
    envelope,
    recoveryPassphrase: passphrase,
    walletSignature: wrongSignature,
  }), /wallet signature/)
})

test('serialized identity backup does not contain the plaintext private key', () => {
  const privateKey = generatePrivateKey()
  const address = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createRecoveryChallenge(address))
  const envelope = createIdentityBackupEnvelope({
    privateKey,
    recoveryPassphrase: 'correct passphrase',
    walletSignature: signature,
  })
  const serialized = serializeIdentityBackupEnvelope(envelope).toLowerCase()
  const stripped = privateKey.slice(2).toLowerCase()

  assert.equal(serialized.includes(stripped), false)
  assert.equal(serialized.includes(address.toLowerCase()), true)
})

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

  assert.match(challenge, /^ethagent encrypted state access\n/)
  assert.match(challenge, new RegExp(`Owner: ${ownerAddress}`))
  assert.match(challenge, /Action: authorize this wallet to unlock the encrypted agent snapshot/)
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
  }), /wallet signature/)
})

test('agent state snapshot owner check detects token transfer before wallet signing', () => {
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

  assert.doesNotThrow(() => assertAgentStateSnapshotOwner(envelope, ownerAddress))
  assert.throws(() => assertAgentStateSnapshotOwner(envelope, otherAddress), /previous wallet/)
})
