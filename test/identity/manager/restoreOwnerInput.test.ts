import test from 'node:test'
import assert from 'node:assert/strict'
import { identityManagerReducer, type Step } from '../../../src/identity/manager/reducer.js'

test('restore flow starts with wallet connection and backs to manager', () => {
  const fromMenu = identityManagerReducer({ kind: 'menu' }, { type: 'setStep', step: { kind: 'restore-wallet' } })
  assert.deepEqual(fromMenu, { kind: 'restore-wallet' })

  const walletBack = identityManagerReducer({ kind: 'restore-wallet', purpose: 'switch' }, {
    type: 'back',
    from: { kind: 'restore-wallet', purpose: 'switch' },
  })
  assert.deepEqual(walletBack, { kind: 'menu' })

  const network: Step = {
    kind: 'restore-network',
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    purpose: 'switch',
  }
  const back = identityManagerReducer(network, { type: 'back', from: network })
  assert.deepEqual(back, { kind: 'menu' })
})
