import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import {
  applyEnsValidationState,
  applyOperatorProfileState,
} from '../../../../src/identity/hub/effects/profile/profileState.js'
import {
  ensRecordWritesForUpdate,
  runUpdateEnsRecords,
} from '../../../../src/identity/hub/effects/ens/index.js'
import {
  resolveAgentTokenIdToCandidate,
} from '../../../../src/identity/hub/effects/restore/index.js'
import { RegisterAgentPreflightError } from '../../../../src/identity/registry/erc8004.js'
import { registry } from './effects.fixtures.js'

test('advanced ENS save state records owner wallet and operator wallet only after validation passes', () => {
  const state: Record<string, unknown> = { ensName: 'agent.example.eth' }
  applyEnsValidationState(
    state,
    {
      ok: true,
      resolvedAddress: '0x000000000000000000000000000000000000c01d',
      resolverAddress: '0x0000000000000000000000000000000000001234',
    },
    {
      custodyMode: 'advanced',
      ownerAddress: '0x000000000000000000000000000000000000c01d',
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
      approvedOperatorWallets: ['0x0000000000000000000000000000000000000A11'],
    },
    {},
  )

  assert.equal(state.custodyMode, 'advanced')
  assert.equal(state.ownerAddress, getAddress('0x000000000000000000000000000000000000c01d'))
  assert.deepEqual(state.approvedOperatorWallets, [{ address: getAddress('0x0000000000000000000000000000000000000A11') }])
  assert.equal(state.activeOperatorAddress, getAddress('0x0000000000000000000000000000000000000A11'))
})

test('advanced ENS save state preserves existing approved operator wallets while setting active operator wallet', () => {
  const state: Record<string, unknown> = { ensName: 'agent.example.eth' }
  applyEnsValidationState(
    state,
    {
      ok: true,
      resolvedAddress: '0x000000000000000000000000000000000000c01d',
      resolverAddress: '0x0000000000000000000000000000000000001234',
    },
    {
      custodyMode: 'advanced',
      ownerAddress: '0x000000000000000000000000000000000000c01d',
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
    },
    {
      approvedOperatorWallets: [
        {
          address: getAddress('0x0000000000000000000000000000000000000B22'),
          verifiedAt: '2026-05-04T00:00:00.000Z',
        },
      ],
    },
  )

  assert.deepEqual(state.approvedOperatorWallets, [
    {
      address: getAddress('0x0000000000000000000000000000000000000B22'),
      verifiedAt: '2026-05-04T00:00:00.000Z',
    },
    { address: getAddress('0x0000000000000000000000000000000000000A11') },
  ])
  assert.equal(state.activeOperatorAddress, getAddress('0x0000000000000000000000000000000000000A11'))
})

test('operator wallet profile state requires active operator wallet to be approved', () => {
  assert.throws(() => applyOperatorProfileState(
    {},
    {
      approvedOperatorWallets: ['0x0000000000000000000000000000000000000A11'],
      activeOperatorAddress: '0x0000000000000000000000000000000000000B22',
    },
    {},
  ), /active operator wallet must be one of the approved operator wallets/i)

  const state: Record<string, unknown> = {}
  applyOperatorProfileState(
    state,
    {
      approvedOperatorWallets: ['0x0000000000000000000000000000000000000A11'],
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
    },
    {},
  )
  assert.deepEqual(state.approvedOperatorWallets, [{ address: getAddress('0x0000000000000000000000000000000000000A11') }])
  assert.equal(state.activeOperatorAddress, getAddress('0x0000000000000000000000000000000000000A11'))
})

test('advanced ENS save state rejects incoherent validation', () => {
  assert.throws(() => applyEnsValidationState(
    { ensName: 'agent.example.eth' },
    { ok: false, reason: 'token-owner-mismatch', detail: 'owned by operator wallet' },
    {
      custodyMode: 'advanced',
      ownerAddress: '0x000000000000000000000000000000000000c01d',
      activeOperatorAddress: '0x0000000000000000000000000000000000000A11',
    },
    {},
  ), /token not held by owner wallet/i)
})

test('ENS record update writes only changed text records', () => {
  const writes = ensRecordWritesForUpdate({
    currentRecords: {
      token: 'eip155:1:0x0000000000000000000000000000000000000001:1',
      profile: 'ipfs://old',
    },
    records: {
      token: 'eip155:1:0x0000000000000000000000000000000000000001:1',
      profile: 'ipfs://new',
    },
  })

  assert.deepEqual(writes, {
    'org.ethagent.profile': 'ipfs://new',
  })
})

test('ENS record clearing writes empty strings only for populated records', () => {
  const writes = ensRecordWritesForUpdate({
    clearRecords: true,
    currentRecords: {
      token: 'eip155:1:0x0000000000000000000000000000000000000001:1',
      profile: '',
    },
    records: { token: '', profile: '' },
  })

  assert.deepEqual(writes, {
    'org.ethagent.token': '',
  })
})

test('ENS record clearing does not blindly write records when current values are unknown', () => {
  const writes = ensRecordWritesForUpdate({
    clearRecords: true,
    records: { token: '', profile: '' },
  })

  assert.deepEqual(writes, {})
})

test('ENS record update preflights resolver transaction before opening wallet', async () => {
  const owner = getAddress('0x000000000000000000000000000000000000c01d')
  let estimated = false
  await assert.rejects(
    runUpdateEnsRecords({
      fullName: 'agent.example.eth',
      ownerAddress: owner,
      records: { profile: 'ipfs://new' },
      currentRecords: { profile: 'ipfs://old' },
      purpose: 'update-ens-records',
      callbacks: {
        onStep: () => {},
        onWalletReady: () => {
          throw new Error('wallet should not open after preflight revert')
        },
        onIdentityComplete: async () => {},
      },
      publicClient: {
        readContract: async (call: { functionName: string }) => {
          if (call.functionName === 'resolver') return '0x0000000000000000000000000000000000001234'
          throw new Error(`unexpected read: ${call.functionName}`)
        },
        estimateGas: async (call: { account: string }) => {
          estimated = true
          assert.equal(call.account, owner)
          throw new Error('execution reverted')
        },
      } as any,
    }),
    (err: unknown) => {
      assert.equal(estimated, true)
      assert.ok(err instanceof RegisterAgentPreflightError)
      assert.equal(err.title, 'ENS Record Update Blocked')
      assert.match(err.detail, /execution reverted/)
      assert.match(err.hint, /No transaction was sent/)
      assert.match(err.hint, /ENS owner wallet/)
      return true
    },
  )
})

test('resolveAgentTokenIdToCandidate rejects empty input before any network call', async () => {
  const result = await resolveAgentTokenIdToCandidate('', registry)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.message, /Enter the agent token ID/)
})

test('resolveAgentTokenIdToCandidate rejects non-integer input before any network call', async () => {
  const result = await resolveAgentTokenIdToCandidate('not-a-number', registry)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.message, /positive integer/)
})

test('resolveAgentTokenIdToCandidate rejects negative tokens before any network call', async () => {
  const result = await resolveAgentTokenIdToCandidate('-5', registry)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.message, /positive integer/)
})
