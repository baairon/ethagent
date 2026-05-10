import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
  assertContinuitySnapshotOwner,
  createContinuitySnapshotChallenge,
  createContinuitySnapshotEnvelope,
  createTransferContinuitySnapshotChallenge,
  createTransferContinuitySnapshotEnvelope,
  createWalletContinuitySnapshotEnvelope,
  createWalletRestoreAccessChallenge,
  createWalletRestoreAccessKey,
  restoreContinuitySnapshotEnvelope,
  serializeContinuitySnapshotEnvelope,
  transferSnapshotMetadataFromEnvelope,
} from '../../../src/identity/continuity/envelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../../../src/identity/crypto/eth.js'

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

  assert.match(challenge, /^Save or Restore Identity Files\n/)
  assert.doesNotMatch(challenge, /^ethagent:/i)
  assert.match(challenge, new RegExp(`Owner: ${ownerAddress}`))
  assert.match(challenge, /Action: encrypt or decrypt local identity files/)
  assert.match(challenge, /Private: SOUL\.md, MEMORY\.md/)
  assert.match(challenge, /Public: public skills and profile/)
  assert.match(challenge, /Safety: no transaction, spending, or approvals/)
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
  }), /wallet signature/i)
})

test('legacy continuity snapshot owner check blocks transferred-token owner before signing', () => {
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

test('transfer continuity snapshot restores for the receiver wallet after token transfer', () => {
  const sourcePrivateKey = generatePrivateKey()
  const targetPrivateKey = generatePrivateKey()
  const sourceOwner = addressFromPrivateKey(sourcePrivateKey)
  const targetOwner = addressFromPrivateKey(targetPrivateKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '42',
  }
  const files = {
    'SOUL.md': '# Private soul\nportable continuity\n',
    'MEMORY.md': '# Private memory\nportable facts\n',
  }
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'sender' })
  const receiverChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'receiver' })
  assert.match(senderChallenge, /^Prepare Transfer Snapshot · Sender Restore Slot\n/)
  assert.match(receiverChallenge, /^Prepare Transfer Snapshot · Receiver Restore Slot\n/)
  assert.match(senderChallenge, /Receiver Owner:/)
  assert.doesNotMatch(senderChallenge, /Target Owner:/)
  assert.doesNotMatch(senderChallenge, /^ethagent:/i)
  const sourceSignature = signMessage(sourcePrivateKey, senderChallenge)
  const targetSignature = signMessage(targetPrivateKey, receiverChallenge)
  const envelope = createTransferContinuitySnapshotEnvelope({
    ownerAddress: sourceOwner,
    ownerWalletSignature: sourceSignature,
    targetAddress: targetOwner,
    targetWalletSignature: targetSignature,
    targetHandle: 'recipient.eth',
    token,
    payload: {
      createdAt: new Date(0).toISOString(),
      agent: { chainId: 8453, agentId: '42' },
      files,
      transcript: [],
      state: { name: 'portable agent' },
    },
  })

  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: targetSignature,
    currentOwnerAddress: targetOwner,
  })

  assert.equal(envelope.crypto.decryptsWith, 'transfer-signature-slot')
  assert.equal(envelope.targetAddress, targetOwner)
  assert.equal(envelope.targetHandle, 'recipient.eth')
  assert.deepEqual(transferSnapshotMetadataFromEnvelope(envelope), {
    kind: 'dual-wallet',
    senderAddress: sourceOwner,
    receiverAddress: targetOwner,
    receiverHandle: 'recipient.eth',
    slotCount: 2,
    createdAt: new Date(0).toISOString(),
  })
  assert.deepEqual(restored.files, files)
  assert.deepEqual(restored.state, { name: 'portable agent' })
  assert.equal(restored.ownerAddress, sourceOwner)
})

test('transfer continuity snapshot also remains readable by the sender before external transfer', () => {
  const sourcePrivateKey = generatePrivateKey()
  const targetPrivateKey = generatePrivateKey()
  const sourceOwner = addressFromPrivateKey(sourcePrivateKey)
  const targetOwner = addressFromPrivateKey(targetPrivateKey)
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '7',
  }
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'sender' })
  const receiverChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'receiver' })
  const sourceSignature = signMessage(sourcePrivateKey, senderChallenge)
  const targetSignature = signMessage(targetPrivateKey, receiverChallenge)
  const envelope = createTransferContinuitySnapshotEnvelope({
    ownerAddress: sourceOwner,
    ownerWalletSignature: sourceSignature,
    targetAddress: targetOwner,
    targetWalletSignature: targetSignature,
    token,
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
  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: sourceSignature,
    currentOwnerAddress: sourceOwner,
  })

  assert.equal(restored.ownerAddress, sourceOwner)
})

test('createTransferContinuitySnapshotChallenge produces role-specific headers; body lines match across roles', () => {
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '99',
  }
  const ownerAddress = '0x1111111111111111111111111111111111111111'
  const targetAddress = '0x2222222222222222222222222222222222222222'
  const senderText = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'sender' })
  const receiverText = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'receiver' })
  const legacyText = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress })

  const senderLines = senderText.split('\n')
  const receiverLines = receiverText.split('\n')
  const legacyLines = legacyText.split('\n')

  assert.equal(senderLines[0], 'Prepare Transfer Snapshot · Sender Restore Slot')
  assert.equal(receiverLines[0], 'Prepare Transfer Snapshot · Receiver Restore Slot')
  assert.equal(legacyLines[0], 'Prepare Transfer Restore Snapshot')
  assert.deepEqual(senderLines.slice(1), receiverLines.slice(1))
  assert.deepEqual(senderLines.slice(1), legacyLines.slice(1))
})

test('transfer envelope stores role-specific challenge text in each slot', () => {
  const sourcePrivateKey = generatePrivateKey()
  const targetPrivateKey = generatePrivateKey()
  const sourceOwner = addressFromPrivateKey(sourcePrivateKey)
  const targetOwner = addressFromPrivateKey(targetPrivateKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '12',
  }
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'sender' })
  const receiverChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'receiver' })
  const envelope = createTransferContinuitySnapshotEnvelope({
    ownerAddress: sourceOwner,
    ownerWalletSignature: signMessage(sourcePrivateKey, senderChallenge),
    targetAddress: targetOwner,
    targetWalletSignature: signMessage(targetPrivateKey, receiverChallenge),
    token,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'a', 'MEMORY.md': 'b' },
      transcript: [],
      state: {},
    },
  })
  assert.match(envelope.slots.owner.challenge, /^Prepare Transfer Snapshot · Sender Restore Slot\n/)
  assert.match(envelope.slots.target.challenge, /^Prepare Transfer Snapshot · Receiver Restore Slot\n/)
  assert.match(envelope.challenge, /^Prepare Transfer Restore Snapshot\n/)
})

test('transfer envelope rejects signatures made against the legacy shared challenge (defense in depth)', () => {
  const sourcePrivateKey = generatePrivateKey()
  const targetPrivateKey = generatePrivateKey()
  const sourceOwner = addressFromPrivateKey(sourcePrivateKey)
  const targetOwner = addressFromPrivateKey(targetPrivateKey)
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '1',
  }
  const legacyChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner })
  assert.throws(() => createTransferContinuitySnapshotEnvelope({
    ownerAddress: sourceOwner,
    ownerWalletSignature: signMessage(sourcePrivateKey, legacyChallenge),
    targetAddress: targetOwner,
    targetWalletSignature: signMessage(targetPrivateKey, legacyChallenge),
    token,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'a', 'MEMORY.md': 'b' },
      transcript: [],
      state: {},
    },
  }))
})

test('transfer continuity snapshot rejects wallets that are neither sender nor receiver', () => {
  const sourcePrivateKey = generatePrivateKey()
  const targetPrivateKey = generatePrivateKey()
  const otherPrivateKey = generatePrivateKey()
  const sourceOwner = addressFromPrivateKey(sourcePrivateKey)
  const targetOwner = addressFromPrivateKey(targetPrivateKey)
  const otherOwner = addressFromPrivateKey(otherPrivateKey)
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '7',
  }
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'sender' })
  const receiverChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress: sourceOwner, targetAddress: targetOwner, role: 'receiver' })
  const envelope = createTransferContinuitySnapshotEnvelope({
    ownerAddress: sourceOwner,
    ownerWalletSignature: signMessage(sourcePrivateKey, senderChallenge),
    targetAddress: targetOwner,
    targetWalletSignature: signMessage(targetPrivateKey, receiverChallenge),
    token,
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
    walletSignature: signMessage(otherPrivateKey, envelope.challenge),
    currentOwnerAddress: otherOwner,
  }), /transfer snapshot receiver/i)
  assert.throws(() => assertContinuitySnapshotOwner(envelope, otherOwner), /transfer snapshot receiver/i)
})

test('wallet continuity snapshot restores with owner and authorized operator wallet slots', () => {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const operatorAddress = addressFromPrivateKey(operatorKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '42',
  }
  const ownerChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress, accessEpoch: 1 })
  const operatorChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: operatorAddress, accessEpoch: 1 })
  const ownerSignature = signMessage(ownerKey, ownerChallenge)
  const operatorSignature = signMessage(operatorKey, operatorChallenge)
  const ownerAccessKey = createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: ownerAddress, walletSignature: ownerSignature, accessEpoch: 1 })
  const operatorAccessKey = createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: operatorAddress, walletSignature: operatorSignature, accessEpoch: 1 })
  const files = {
    'SOUL.md': 'owner and operator',
    'MEMORY.md': 'restore slots',
  }

  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: ownerSignature,
    token,
    accessEpoch: 1,
    accessKeys: [ownerAccessKey, operatorAccessKey],
    payload: {
      agent: { chainId: token.chainId, agentId: token.agentId },
      files,
      transcript: [],
      state: { name: 'slot agent' },
    },
  })
  const ownerRestored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: ownerSignature,
    currentOwnerAddress: ownerAddress,
  })
  const operatorRestored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: operatorSignature,
    currentOwnerAddress: operatorAddress,
  })

  assert.equal(envelope.crypto.decryptsWith, 'wallet-signature-slots')
  assert.equal(envelope.slots.length, 2)
  assert.deepEqual(ownerRestored.files, files)
  assert.deepEqual(operatorRestored.files, files)
})

test('operator-created wallet snapshot preserves every owner-authorized slot', () => {
  const ownerKey = generatePrivateKey()
  const operatorOneKey = generatePrivateKey()
  const operatorTwoKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const operatorOne = addressFromPrivateKey(operatorOneKey)
  const operatorTwo = addressFromPrivateKey(operatorTwoKey)
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '7',
  }
  const accessKeys = [
    { key: ownerKey, address: ownerAddress },
    { key: operatorOneKey, address: operatorOne },
    { key: operatorTwoKey, address: operatorTwo },
  ].map(item => {
    const challenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: item.address, accessEpoch: 3 })
    return createWalletRestoreAccessKey({
      token,
      ownerAddress,
      walletAddress: item.address,
      walletSignature: signMessage(item.key, challenge),
      accessEpoch: 3,
    })
  })
  const operatorOneChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: operatorOne, accessEpoch: 3 })
  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: operatorOne,
    signerWalletSignature: signMessage(operatorOneKey, operatorOneChallenge),
    token,
    accessEpoch: 3,
    accessKeys,
    payload: {
      agent: {},
      files: {
        'SOUL.md': 'preserved',
        'MEMORY.md': 'preserved',
      },
      transcript: [],
      state: {},
    },
  })

  assert.deepEqual(envelope.slots.map(slot => slot.address).sort(), [ownerAddress, operatorOne, operatorTwo].sort())
  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signMessage(operatorTwoKey, createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: operatorTwo, accessEpoch: 3 })),
    currentOwnerAddress: operatorTwo,
  })
  assert.equal(restored.files['SOUL.md'], 'preserved')
})

test('wallet continuity snapshot rejects unapproved wallets', () => {
  const ownerKey = generatePrivateKey()
  const otherKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const otherAddress = addressFromPrivateKey(otherKey)
  const token = {
    chainId: 1,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '9',
  }
  const ownerChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress })
  const ownerSignature = signMessage(ownerKey, ownerChallenge)
  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: ownerSignature,
    token,
    accessKeys: [
      createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: ownerAddress, walletSignature: ownerSignature }),
    ],
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
    walletSignature: signMessage(otherKey, createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: otherAddress })),
    currentOwnerAddress: otherAddress,
  }), /restore slot missing/i)
})

test('revoked wallet is omitted from new snapshots when access keys exclude it', () => {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const revokedKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const operatorAddress = addressFromPrivateKey(operatorKey)
  const revokedAddress = addressFromPrivateKey(revokedKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '42',
  }

  const epoch1Keys = [ownerAddress, operatorAddress, revokedAddress].map(walletAddress => {
    const key = walletAddress === ownerAddress ? ownerKey : walletAddress === operatorAddress ? operatorKey : revokedKey
    const challenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress, accessEpoch: 1 })
    return createWalletRestoreAccessKey({
      token,
      ownerAddress,
      walletAddress,
      walletSignature: signMessage(key, challenge),
      accessEpoch: 1,
    })
  })

  const ownerChallenge1 = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress, accessEpoch: 1 })
  const envelope1 = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: signMessage(ownerKey, ownerChallenge1),
    token,
    accessEpoch: 1,
    accessKeys: epoch1Keys,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'epoch 1', 'MEMORY.md': 'epoch 1' },
      transcript: [],
      state: {},
    },
  })

  assert.equal(envelope1.slots.length, 3)

  const epoch2Keys = [ownerAddress, operatorAddress].map(walletAddress => {
    const key = walletAddress === ownerAddress ? ownerKey : operatorKey
    const challenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress, accessEpoch: 2 })
    return createWalletRestoreAccessKey({
      token,
      ownerAddress,
      walletAddress,
      walletSignature: signMessage(key, challenge),
      accessEpoch: 2,
    })
  })

  const ownerChallenge2 = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress, accessEpoch: 2 })
  const envelope2 = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: signMessage(ownerKey, ownerChallenge2),
    token,
    accessEpoch: 2,
    accessKeys: epoch2Keys,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'epoch 2', 'MEMORY.md': 'epoch 2' },
      transcript: [],
      state: {},
    },
  })

  assert.equal(envelope2.slots.length, 2)
  assert.equal(envelope2.accessEpoch, 2)

  const revokedChallenge2 = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: revokedAddress, accessEpoch: 2 })
  assert.throws(() => restoreContinuitySnapshotEnvelope({
    envelope: envelope2,
    walletSignature: signMessage(revokedKey, revokedChallenge2),
    currentOwnerAddress: revokedAddress,
  }), /restore slot missing/i)

  const revokedChallenge1 = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: revokedAddress, accessEpoch: 1 })
  const restored = restoreContinuitySnapshotEnvelope({
    envelope: envelope1,
    walletSignature: signMessage(revokedKey, revokedChallenge1),
    currentOwnerAddress: revokedAddress,
  })
  assert.equal(restored.files['SOUL.md'], 'epoch 1')
})

test('old owner-only snapshot cannot be restored by an operator wallet without a slot', () => {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const challenge = createContinuitySnapshotChallenge(ownerAddress)
  const ownerSignature = signMessage(ownerKey, challenge)

  const envelope = createContinuitySnapshotEnvelope({
    ownerAddress,
    walletSignature: ownerSignature,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'owner only', 'MEMORY.md': 'owner only' },
      transcript: [],
      state: {},
    },
  })

  const ownerRestored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: ownerSignature,
  })
  assert.equal(ownerRestored.files['SOUL.md'], 'owner only')

  const operatorChallenge = createContinuitySnapshotChallenge(ownerAddress)
  const operatorSignature = signMessage(operatorKey, operatorChallenge)
  assert.throws(() => restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: operatorSignature,
  }), /wallet signature/i)
})

test('operator cannot modify the access key list — slots are determined by owner-signed manifest', () => {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const operatorAddress = addressFromPrivateKey(operatorKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '42',
  }

  const accessKeys = [ownerAddress, operatorAddress].map(walletAddress => {
    const key = walletAddress === ownerAddress ? ownerKey : operatorKey
    const challenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress, accessEpoch: 1 })
    return createWalletRestoreAccessKey({ token, ownerAddress, walletAddress, walletSignature: signMessage(key, challenge), accessEpoch: 1 })
  })

  const operatorChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: operatorAddress, accessEpoch: 1 })
  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: operatorAddress,
    signerWalletSignature: signMessage(operatorKey, operatorChallenge),
    token,
    accessEpoch: 1,
    accessKeys,
    payload: {
      agent: {},
      files: { 'SOUL.md': 'operator snapshot', 'MEMORY.md': 'operator snapshot' },
      transcript: [],
      state: {},
    },
  })

  assert.equal(envelope.slots.length, 2)
  assert.deepEqual(
    envelope.slots.map(s => s.address).sort(),
    [ownerAddress, operatorAddress].sort(),
  )

  assert.equal(typeof envelope.accessManifestHash, 'string')
  assert.ok(envelope.accessManifestHash.length > 0)
})

test('v2 purpose-bound challenge survives a full save and restore round trip', () => {
  const ownerKey = generatePrivateKey()
  const operatorKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const operatorAddress = addressFromPrivateKey(operatorKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '99',
  }
  const ownerChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress, accessEpoch: 1, purpose: 'clear-ens-snapshot' })
  const operatorChallenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: operatorAddress, accessEpoch: 1, purpose: 'operator-proof' })
  const ownerSignature = signMessage(ownerKey, ownerChallenge)
  const operatorSignature = signMessage(operatorKey, operatorChallenge)
  const ownerAccessKey = createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: ownerAddress, walletSignature: ownerSignature, accessEpoch: 1, purpose: 'clear-ens-snapshot' })
  const operatorAccessKey = createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: operatorAddress, walletSignature: operatorSignature, accessEpoch: 1, purpose: 'operator-proof' })

  assert.match(ownerAccessKey.challenge, /^Clear ENS from Agent Snapshot\n/)
  assert.match(ownerAccessKey.challenge, /No onchain ENS records change\./)
  assert.match(ownerAccessKey.challenge, /Version: 2$/)
  assert.match(operatorAccessKey.challenge, /^Authorize Operator Wallet Restore Access\n/)

  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: ownerSignature,
    token,
    accessEpoch: 1,
    accessKeys: [ownerAccessKey, operatorAccessKey],
    payload: {
      agent: { chainId: token.chainId, agentId: token.agentId },
      files: { 'SOUL.md': 'v2 soul', 'MEMORY.md': 'v2 memory' },
      transcript: [],
      state: { name: 'v2 agent' },
    },
  })

  const ownerSlot = envelope.slots.find(s => s.address.toLowerCase() === ownerAddress.toLowerCase())
  const operatorSlot = envelope.slots.find(s => s.address.toLowerCase() === operatorAddress.toLowerCase())
  assert.ok(ownerSlot)
  assert.ok(operatorSlot)
  assert.match(ownerSlot!.challenge, /^Clear ENS from Agent Snapshot\n/)
  assert.match(operatorSlot!.challenge, /^Authorize Operator Wallet Restore Access\n/)

  const ownerRestored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signMessage(ownerKey, ownerSlot!.challenge),
    currentOwnerAddress: ownerAddress,
  })
  const operatorRestored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signMessage(operatorKey, operatorSlot!.challenge),
    currentOwnerAddress: operatorAddress,
  })
  assert.deepEqual(ownerRestored.files, { 'SOUL.md': 'v2 soul', 'MEMORY.md': 'v2 memory' })
  assert.deepEqual(operatorRestored.files, { 'SOUL.md': 'v2 soul', 'MEMORY.md': 'v2 memory' })
})

test('v1 envelopes still restore after the v2 change (back-compat passthrough)', () => {
  const ownerKey = generatePrivateKey()
  const ownerAddress = addressFromPrivateKey(ownerKey)
  const token = {
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '7',
  }
  const v1Challenge = createWalletRestoreAccessChallenge({ token, ownerAddress, walletAddress: ownerAddress, accessEpoch: 1 })
  assert.match(v1Challenge, /^Authorize Wallet Restore Access\n/)
  assert.match(v1Challenge, /Version: 1$/)

  const v1Signature = signMessage(ownerKey, v1Challenge)
  const v1AccessKey = createWalletRestoreAccessKey({ token, ownerAddress, walletAddress: ownerAddress, walletSignature: v1Signature, accessEpoch: 1 })
  const envelope = createWalletContinuitySnapshotEnvelope({
    ownerAddress,
    signerAddress: ownerAddress,
    signerWalletSignature: v1Signature,
    token,
    accessEpoch: 1,
    accessKeys: [v1AccessKey],
    payload: {
      agent: { chainId: token.chainId, agentId: token.agentId },
      files: { 'SOUL.md': 'pre-migration', 'MEMORY.md': 'pre-migration' },
      transcript: [],
      state: { name: 'legacy' },
    },
  })

  assert.equal(envelope.slots.length, 1)
  assert.match(envelope.slots[0]!.challenge, /^Authorize Wallet Restore Access\n/)

  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: signMessage(ownerKey, envelope.slots[0]!.challenge),
    currentOwnerAddress: ownerAddress,
  })
  assert.deepEqual(restored.files, { 'SOUL.md': 'pre-migration', 'MEMORY.md': 'pre-migration' })
})
