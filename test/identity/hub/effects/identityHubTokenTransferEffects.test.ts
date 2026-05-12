import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import {
  runTokenTransferTargetSubmit,
  tokenTransferProgressForPhase,
} from '../../../../src/identity/hub/transfer/effects.js'
import { identityFixture, registry } from './effects.fixtures.js'

test('token transfer progress identifies the required wallet for each signing step', () => {
  const sender = getAddress('0x0000000000000000000000000000000000000A11')
  const receiver = getAddress('0x0000000000000000000000000000000000000B22')

  assert.deepEqual(tokenTransferProgressForPhase('sender-sign', sender, receiver), {
    phase: 'sender-sign',
    walletRole: 'sender',
    expectedAddress: sender,
    title: 'Use Sender Wallet',
    detail: 'Sign to save a transfer snapshot.',
    walletAction: 'Sign Snapshot',
    label: 'Sender Wallet: sign to save the transfer snapshot.',
  })
  assert.equal(tokenTransferProgressForPhase('target-sign', sender, receiver).expectedAddress, receiver)
  assert.equal(tokenTransferProgressForPhase('target-sign', sender, receiver).walletRole, 'receiver')
  assert.equal(tokenTransferProgressForPhase('target-sign', sender, receiver).title, 'Use Receiver Wallet')
  assert.equal(tokenTransferProgressForPhase('sender-transaction', sender, receiver).title, 'Use Sender Wallet Again')
  assert.equal(tokenTransferProgressForPhase('pinning', sender, receiver).walletRole, 'none')
  assert.equal(tokenTransferProgressForPhase('confirming', sender, receiver).walletRole, 'none')
})

test('token transfer target submit respects cancellation before resolving', async () => {
  const controller = new AbortController()
  controller.abort()
  const steps: unknown[] = []

  await assert.rejects(
    runTokenTransferTargetSubmit(
      'receiver.eth',
      { kind: 'token-transfer-target', identity: { ...identityFixture, agentId: '1' }, registry },
      {
        onStep: step => steps.push(step),
        onWalletReady: () => {},
        onIdentityComplete: async () => {},
      },
      { signal: controller.signal },
    ),
    /token transfer preparation cancelled/,
  )

  assert.deepEqual(steps, [])
})
