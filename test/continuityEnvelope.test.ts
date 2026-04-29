import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
  assertContinuitySnapshotOwner,
  createContinuitySnapshotChallenge,
  createContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
} from '../src/identity/continuity/envelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../src/identity/eth.js'

test('continuity snapshot envelope encrypts and restores SOUL and MEMORY files', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const files = {
    'SOUL.md': '# Private soul\nowner-only continuity\n',
    'MEMORY.md': '# Private memory\nproject facts\n',
  }

  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 1, agentId: '7' },
      files,
      transcript: [{ sessionId: 'session-one', summary: 'durable summary' }],
      state: { name: 'agent' },
    },
  })
  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signature,
  })

  assert.equal(envelope.envelopeVersion, CONTINUITY_SNAPSHOT_ENVELOPE_VERSION)
  assert.equal(envelope.crypto.kem, 'ML-KEM-1024')
  assert.deepEqual(restored.files, files)
  assert.deepEqual(restored.transcript, [{ sessionId: 'session-one', summary: 'durable summary' }])
  assert.deepEqual(restored.state, { name: 'agent' })
  assert.equal(restored.ownerAddress, ownerAddress)
})

test('continuity snapshot challenge explains purpose, scope, and wallet safety', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const challenge = createContinuitySnapshotChallenge(ownerAddress)

  assert.match(challenge, /^ethagent private continuity\n/)
  assert.match(challenge, new RegExp(`Owner: ${ownerAddress}`))
  assert.match(challenge, /Purpose: unlock the encrypted SOUL\.md and MEMORY\.md snapshot for this device/)
  assert.match(challenge, /Scope: read and restore private agent continuity only/)
  assert.match(challenge, /does not send a transaction, spend funds, or grant token approval/)
  assert.match(challenge, /Version: 1$/)
})

test('serialized continuity snapshot excludes plaintext private files and wallet signature', () => {
  const privateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      agent: {},
      files: {
        'SOUL.md': 'secret soul marker',
        'MEMORY.md': 'secret memory marker',
      },
      transcript: [{ summary: 'secret transcript marker' }],
      state: { secretState: 'secret state marker' },
    },
  })
  const serialized = serializeContinuitySnapshotEnvelope(envelope)

  assert.equal(serialized.includes('secret soul marker'), false)
  assert.equal(serialized.includes('secret memory marker'), false)
  assert.equal(serialized.includes('secret transcript marker'), false)
  assert.equal(serialized.includes('secret state marker'), false)
  assert.equal(serialized.includes(signature), false)
})

test('continuity snapshot decrypt fails for a non-owner wallet', () => {
  const privateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const wrongSignature = signMessage(otherPrivateKey, createContinuitySnapshotChallenge(ownerAddress))
  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      agent: {},
      files: {
        'SOUL.md': 'owner only',
        'MEMORY.md': 'owner only',
      },
      transcript: [],
      state: {},
    },
  })

  assert.throws(() => restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: wrongSignature,
  }), /wallet signature/)
})

test('continuity snapshot owner check blocks transferred-token owner before signing', () => {
  const privateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(privateKey)
  const otherAddress = addressFromPrivateKey(otherPrivateKey)
  const signature = signMessage(privateKey, createContinuitySnapshotChallenge(ownerAddress))
  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: signature,
    payload: {
      agent: {},
      files: {
        'SOUL.md': 'owner only',
        'MEMORY.md': 'owner only',
      },
      transcript: [],
      state: {},
    },
  })

  assert.doesNotThrow(() => assertContinuitySnapshotOwner(envelope, ownerAddress))
  assert.throws(() => assertContinuitySnapshotOwner(envelope, otherAddress), /another wallet/)
})
