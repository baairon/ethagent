import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acquireTxGuard,
  isTxGuardBusy,
  releaseTxGuard,
  resetTxGuardForTest,
  txGuardBusyMessage,
} from '../../../src/identity/hub/txGuard.js'

test('txGuard acquire and release toggles busy flag', () => {
  resetTxGuardForTest()
  assert.equal(isTxGuardBusy('rebackup'), false)
  acquireTxGuard('rebackup')
  assert.equal(isTxGuardBusy('rebackup'), true)
  releaseTxGuard('rebackup')
  assert.equal(isTxGuardBusy('rebackup'), false)
})

test('txGuard tolerates re-acquire of same kind without throwing', () => {
  resetTxGuardForTest()
  acquireTxGuard('rebackup')
  try {
    assert.doesNotThrow(() => acquireTxGuard('rebackup'))
    assert.equal(isTxGuardBusy('rebackup'), true)
  } finally {
    releaseTxGuard('rebackup')
  }
})

test('txGuard tracks each kind independently', () => {
  resetTxGuardForTest()
  acquireTxGuard('rebackup')
  acquireTxGuard('public-profile')
  assert.equal(isTxGuardBusy('rebackup'), true)
  assert.equal(isTxGuardBusy('public-profile'), true)
  assert.equal(isTxGuardBusy('vault-deploy'), false)
  releaseTxGuard('rebackup')
  releaseTxGuard('public-profile')
})

test('txGuard releases after a finally block when wrapped function rejects', async () => {
  resetTxGuardForTest()
  const failing = async (): Promise<void> => {
    acquireTxGuard('rebackup')
    try {
      throw new Error('boom')
    } finally {
      releaseTxGuard('rebackup')
    }
  }
  await assert.rejects(failing, /boom/)
  assert.equal(isTxGuardBusy('rebackup'), false)
})

test('txGuard messages cover every kind', () => {
  assert.match(txGuardBusyMessage('rebackup'), /snapshot save/)
  assert.match(txGuardBusyMessage('public-profile'), /public profile/)
  assert.match(txGuardBusyMessage('vault-deploy'), /vault deploy/)
  assert.match(txGuardBusyMessage('vault-deposit'), /vault deposit/)
  assert.match(txGuardBusyMessage('vault-unwrap'), /vault unwrap/)
  assert.match(txGuardBusyMessage('vault-withdraw'), /token withdraw/)
})
