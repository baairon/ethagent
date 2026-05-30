import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createContinuityEnvelopeForSave,
} from '../../../../src/identity/manager/continuity/snapshot.js'
import {
  createWalletRestoreAccessChallenge,
  isWalletContinuitySnapshotEnvelope,
  restoreContinuitySnapshotEnvelope,
} from '../../../../src/identity/continuity/envelope.js'
import { signMessage } from '../../../../src/identity/crypto/eth.js'
import {
  buildEnvelopeFixtures,
  ENVELOPE_FILES,
  ENVELOPE_REGISTRY,
} from './effects.fixtures.js'

test('createContinuityEnvelopeForSave: operator routine save rebuilds the operator slot from the fresh signature', () => {
  const f = buildEnvelopeFixtures()
  const saveChallenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.operatorAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'update-snapshot',
  })
  const saveSignature = signMessage(f.operatorKey, saveChallenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  const envelope = createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.operatorAddress,
    walletSignature: saveSignature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'update-snapshot',
  })

  assert.equal(isWalletContinuitySnapshotEnvelope(envelope), true)
  if (!isWalletContinuitySnapshotEnvelope(envelope)) return
  const operatorSlot = envelope.slots.find(s => s.address.toLowerCase() === f.operatorAddress.toLowerCase())
  assert.ok(operatorSlot, 'operator slot present in envelope')
  assert.match(operatorSlot!.challenge, /Action: encrypt the updated agent snapshot/)
  assert.doesNotMatch(operatorSlot!.challenge, /Action: prove this operator wallet can decrypt future snapshots/)
})

test('createContinuityEnvelopeForSave: stored operator key is left untouched after the save', () => {
  const f = buildEnvelopeFixtures()
  const saveChallenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.operatorAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'update-snapshot',
  })
  const saveSignature = signMessage(f.operatorKey, saveChallenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.operatorAddress,
    walletSignature: saveSignature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'update-snapshot',
  })

  const storedOperatorWallets = stateForEnvelope.approvedOperatorWallets as Array<{ address: string; restoreAccessKey: { challenge: string } }>
  const storedOperator = storedOperatorWallets.find(r => r.address.toLowerCase() === f.operatorAddress.toLowerCase())
  assert.ok(storedOperator)
  assert.match(storedOperator!.restoreAccessKey.challenge, /Action: prove this operator wallet can decrypt future snapshots/)
})

test('createContinuityEnvelopeForSave: non-signing operators keep their stored challenge in the envelope', () => {
  const f = buildEnvelopeFixtures()
  const saveChallenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.operatorAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'update-snapshot',
  })
  const saveSignature = signMessage(f.operatorKey, saveChallenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  const envelope = createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.operatorAddress,
    walletSignature: saveSignature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'update-snapshot',
  })

  if (!isWalletContinuitySnapshotEnvelope(envelope)) throw new Error('expected wallet envelope')
  const otherSlot = envelope.slots.find(s => s.address.toLowerCase() === f.otherOperatorAddress.toLowerCase())
  assert.ok(otherSlot, 'other operator slot present')
  assert.match(otherSlot!.challenge, /Action: prove this operator wallet can decrypt future snapshots/)
})

test('createContinuityEnvelopeForSave: operator can decrypt the snapshot they just signed', () => {
  const f = buildEnvelopeFixtures()
  const saveChallenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.operatorAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'update-snapshot',
  })
  const saveSignature = signMessage(f.operatorKey, saveChallenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  const envelope = createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.operatorAddress,
    walletSignature: saveSignature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'update-snapshot',
  })

  const restored = restoreContinuitySnapshotEnvelope({
    envelope,
    walletSignature: saveSignature,
    currentOwnerAddress: f.operatorAddress,
  })
  assert.deepEqual(restored.files, ENVELOPE_FILES)
})

test('createContinuityEnvelopeForSave: owner-signed slot uses restore-owner title (regression: misleading restore preview)', () => {
  const f = buildEnvelopeFixtures()
  const challenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.ownerAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'restore-owner',
  })
  const signature = signMessage(f.ownerKey, challenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  const envelope = createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.ownerAddress,
    walletSignature: signature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'restore-owner',
  })

  if (!isWalletContinuitySnapshotEnvelope(envelope)) throw new Error('expected wallet envelope')
  const ownerSlot = envelope.slots.find(s => s.address.toLowerCase() === f.ownerAddress.toLowerCase())
  assert.ok(ownerSlot)
  assert.match(ownerSlot!.challenge, /^Restore Agent with Owner Wallet\n/)
})

test('createContinuityEnvelopeForSave: operator-signed slot uses restore-operator title (regression: misleading restore preview)', () => {
  const f = buildEnvelopeFixtures()
  const challenge = createWalletRestoreAccessChallenge({
    token: f.token,
    ownerAddress: f.ownerAddress,
    walletAddress: f.operatorAddress,
    accessEpoch: f.accessEpoch,
    purpose: 'restore-operator',
  })
  const signature = signMessage(f.operatorKey, challenge)
  const stateForEnvelope = JSON.parse(JSON.stringify(f.baseState)) as Record<string, unknown>

  const envelope = createContinuityEnvelopeForSave({
    identity: { address: f.ownerAddress, ownerAddress: f.ownerAddress, createdAt: '2026-01-01', state: stateForEnvelope },
    registry: ENVELOPE_REGISTRY,
    ownerAddress: f.ownerAddress,
    signerAddress: f.operatorAddress,
    walletSignature: signature,
    state: stateForEnvelope,
    files: ENVELOPE_FILES,
    walletAccess: { token: f.token, accessEpoch: f.accessEpoch },
    challengePurpose: 'restore-operator',
  })

  if (!isWalletContinuitySnapshotEnvelope(envelope)) throw new Error('expected wallet envelope')
  const operatorSlot = envelope.slots.find(s => s.address.toLowerCase() === f.operatorAddress.toLowerCase())
  assert.ok(operatorSlot)
  assert.match(operatorSlot!.challenge, /^Restore Agent with Operator Wallet\n/)
})
