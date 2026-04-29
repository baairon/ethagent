import test from 'node:test'
import assert from 'node:assert/strict'
import { identityHubReducer, type Step } from '../src/identity/identityHubReducer.js'

test('restore flow starts with wallet connection instead of manual owner entry', () => {
  const fromMenu = identityHubReducer({ kind: 'menu' }, { type: 'startRestore' })
  assert.deepEqual(fromMenu, { kind: 'restore-wallet' })

  const network: Step = {
    kind: 'restore-network',
    ownerHandle: '0x000000000000000000000000000000000000dEaD',
    purpose: 'switch',
  }
  const back = identityHubReducer(network, { type: 'back', from: network })
  assert.deepEqual(back, { kind: 'restore-owner', purpose: 'switch' })
})
