import test from 'node:test'
import assert from 'node:assert/strict'
import {
  expectedAccountForSnapshotSave,
  snapshotSaveRequiresOwnerSigner,
  snapshotSaveWalletRole,
} from '../../../../src/identity/manager/continuity/snapshot.js'
import {
  multiCustodyIdentity,
  OPERATOR_WALLET,
  OWNER_WALLET,
  RESTORE_KEY_FIXTURE,
} from './effects.fixtures.js'

test('continuity-only save (Save Snapshot Now) is operator-eligible after authorizing an operator wallet', () => {
  assert.equal(snapshotSaveRequiresOwnerSigner(multiCustodyIdentity, undefined), false)
  assert.equal(snapshotSaveWalletRole(multiCustodyIdentity, undefined), 'operator')
  assert.equal(
    expectedAccountForSnapshotSave(multiCustodyIdentity, undefined, {
      token: { chainId: 8453, identityRegistryAddress: '0x0000000000000000000000000000000000000002', agentId: '45744' },
      accessEpoch: 10,
    }),
    undefined,
    'operator save must not pin an expectedAccount; that allows any approved wallet to sign',
  )
})

test('custody update save (authorizing an operator wallet) requires the owner wallet', () => {
  const updates = {
    custodyMode: 'advanced' as const,
    ownerAddress: OWNER_WALLET,
    approvedOperatorWallets: [{ address: OPERATOR_WALLET, restoreAccessKey: RESTORE_KEY_FIXTURE }],
    activeOperatorAddress: OPERATOR_WALLET,
    restoreAccessEpoch: 11,
  }
  assert.equal(snapshotSaveRequiresOwnerSigner(multiCustodyIdentity, updates), true)
  assert.equal(snapshotSaveWalletRole(multiCustodyIdentity, updates), 'owner')
  assert.equal(
    expectedAccountForSnapshotSave(multiCustodyIdentity, updates, null),
    OWNER_WALLET,
    'operator-set changes must rotate the onchain pointer, which only the owner wallet can do',
  )
})

test('public profile changes require the owner wallet when no ENS subdomain is set', () => {
  const updates = { name: 'New Name', description: 'Updated bio' }
  assert.equal(snapshotSaveRequiresOwnerSigner(multiCustodyIdentity, updates), true)
  assert.equal(snapshotSaveWalletRole(multiCustodyIdentity, updates), 'owner')
})

test('public profile changes are operator-eligible in multi-wallet mode with an ENS subdomain', () => {
  const ensIdentity = {
    ...multiCustodyIdentity,
    state: {
      ...multiCustodyIdentity.state,
      ensName: 'agent1.alice.eth',
    },
  }
  const updates = { name: 'New Name', description: 'Updated bio', imagePath: 'ipfs://Qm123' }
  assert.equal(snapshotSaveRequiresOwnerSigner(ensIdentity, updates), false)
  assert.equal(snapshotSaveWalletRole(ensIdentity, updates), 'operator')
})

test('ENS link changes still require the owner wallet even with multi-wallet + ENS', () => {
  const ensIdentity = {
    ...multiCustodyIdentity,
    state: {
      ...multiCustodyIdentity.state,
      ensName: 'agent1.alice.eth',
    },
  }
  const updates = { ensName: 'agent2.alice.eth' }
  assert.equal(snapshotSaveRequiresOwnerSigner(ensIdentity, updates), true)
})
