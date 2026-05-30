import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import {
  restoreSignatureRequestForStep,
} from '../../../../src/identity/manager/restore/auth.js'
import {
  restoreTokenSelectionStep,
} from '../../../../src/identity/manager/restore/discover.js'
import { CONTINUITY_SNAPSHOT_ENVELOPE_VERSION } from '../../../../src/identity/continuity/envelope.js'
import { candidate, registry } from './effects.fixtures.js'

test('restore discovery requires confirmation even when one ERC-8004 agent is found', () => {
  const step = restoreTokenSelectionStep({
    ownerHandle: 'owner.eth',
    registry,
    candidates: [candidate(1n, 'bafy-state')],
    purpose: 'restore',
  })

  assert.equal(step.kind, 'restore-select-token')
  assert.equal(step.candidates.length, 1)
  assert.equal(step.candidates[0]?.backup?.cid, 'bafy-state')
})

test('restore discovery lists every restorable ERC-8004 agent and excludes unrecoverable tokens', () => {
  const step = restoreTokenSelectionStep({
    ownerHandle: 'owner.eth',
    registry,
    candidates: [candidate(1n, 'bafy-one'), candidate(2n), candidate(3n, 'bafy-three')],
    purpose: 'restore',
  })

  assert.deepEqual(step.candidates.map(item => item.agentId), [1n, 3n])
  assert.deepEqual(step.candidates.map(item => item.backup?.cid), ['bafy-one', 'bafy-three'])
})

test('restore authorization reports missing slot when an operator found an owner-only snapshot', () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  assert.throws(() => restoreSignatureRequestForStep({
    kind: 'restore-authorizing',
    cid: 'bafy-state',
    apiUrl: 'https://example.com',
    candidate: {
      ...candidate(1n, 'bafy-state'),
      ownerAddress: owner,
      operators: {
        approvedOperatorWallets: [{ address: operator }],
        activeOperatorAddress: operator,
      },
    },
    requesterAddress: operator,
    purpose: 'restore',
    envelope: {
      version: 1,
      envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
      ownerAddress: owner,
      createdAt: new Date(0).toISOString(),
      challenge: 'owner challenge',
      crypto: {
        kem: 'ML-KEM-1024',
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA256',
        signature: 'EIP-191',
        decryptsWith: 'owner-signature',
      },
      salt: '',
      kemPublicKey: '',
      kemCiphertext: '',
      nonce: '',
      ciphertext: '',
      tag: '',
    },
  }), /Restore Slot Missing/)
})

test('restore authorization uses operator-wallet slot when the snapshot has one for the requester', () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  const slot = {
    address: operator,
    challenge: 'operator slot challenge',
    salt: '',
    nonce: '',
    encryptedKey: '',
    tag: '',
  }
  const request = restoreSignatureRequestForStep({
    kind: 'restore-authorizing',
    cid: 'bafy-state',
    apiUrl: 'https://example.com',
    candidate: { ...candidate(1n, 'bafy-state'), ownerAddress: owner },
    requesterAddress: operator,
    purpose: 'restore',
    envelope: {
      version: 1,
      envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
      ownerAddress: owner,
      createdAt: new Date(0).toISOString(),
      challenge: 'transfer challenge',
      token: {
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: '1',
      },
      targetAddress: operator,
      crypto: {
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA256',
        signature: 'EIP-191',
        decryptsWith: 'transfer-signature-slot',
      },
      payloadNonce: '',
      payloadCiphertext: '',
      payloadTag: '',
      payloadHash: '',
      slots: {
        owner: { ...slot, address: owner, challenge: 'owner slot challenge' },
        target: slot,
      },
    },
  })

  assert.equal(request.expectedAccount, operator)
  assert.equal(request.message, 'operator slot challenge')
  assert.equal(request.purpose, 'restore-operator-wallet')
  assert.equal(request.role, 'operator-wallet')
})

test('restore authorization uses operator wallet slot from multi-wallet snapshots', () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const operator = getAddress('0x0000000000000000000000000000000000000A11')
  const request = restoreSignatureRequestForStep({
    kind: 'restore-authorizing',
    cid: 'bafy-state',
    apiUrl: 'https://example.com',
    candidate: {
      ...candidate(1n, 'bafy-state'),
      ownerAddress: owner,
      operators: {
        approvedOperatorWallets: [{ address: operator }],
        activeOperatorAddress: operator,
      },
    },
    requesterAddress: operator,
    purpose: 'restore',
    envelope: {
      version: 1,
      envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
      ownerAddress: owner,
      createdAt: new Date(0).toISOString(),
      token: {
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: '1',
      },
      accessEpoch: 1,
      accessManifestHash: 'hash',
      crypto: {
        kem: 'ML-KEM-1024',
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA256',
        signature: 'EIP-191',
        decryptsWith: 'wallet-signature-slots',
      },
      payloadNonce: '',
      payloadCiphertext: '',
      payloadTag: '',
      payloadHash: '',
      slots: [{
        address: operator,
        challenge: 'operator restore challenge',
        salt: '',
        kemPublicKey: '',
        kemCiphertext: '',
        nonce: '',
        encryptedKey: '',
        tag: '',
      }],
    },
  })

  assert.equal(request.expectedAccount, operator)
  assert.equal(request.message, 'operator restore challenge')
  assert.equal(request.purpose, 'restore-operator-wallet')
  assert.equal(request.role, 'operator-wallet')
})

test('restore authorization requires owner slot when no requester is known for multi-wallet snapshots', () => {
  const owner = getAddress('0x000000000000000000000000000000000000dEaD')
  const request = restoreSignatureRequestForStep({
    kind: 'restore-authorizing',
    cid: 'bafy-state',
    apiUrl: 'https://example.com',
    candidate: { ...candidate(1n, 'bafy-state'), ownerAddress: owner },
    purpose: 'restore',
    envelope: {
      version: 1,
      envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
      ownerAddress: owner,
      createdAt: new Date(0).toISOString(),
      token: {
        chainId: registry.chainId,
        identityRegistryAddress: registry.identityRegistryAddress,
        agentId: '1',
      },
      accessEpoch: 1,
      accessManifestHash: 'hash',
      crypto: {
        kem: 'ML-KEM-1024',
        aead: 'AES-256-GCM',
        kdf: 'HKDF-SHA256',
        signature: 'EIP-191',
        decryptsWith: 'wallet-signature-slots',
      },
      payloadNonce: '',
      payloadCiphertext: '',
      payloadTag: '',
      payloadHash: '',
      slots: [{
        address: owner,
        challenge: 'owner restore challenge',
        salt: '',
        kemPublicKey: '',
        kemCiphertext: '',
        nonce: '',
        encryptedKey: '',
        tag: '',
      }],
    },
  })

  assert.equal(request.expectedAccount, owner)
  assert.equal(request.message, 'owner restore challenge')
})
