import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeApprovalDiff,
  describeFixPlanItem,
  fixPlanRequiresOwnerWallet,
} from '../../../../src/identity/hub/reconciliation/index.js'

const WALLET_A = '0x000000000000000000000000000000000000000A' as `0x${string}`
const WALLET_B = '0x000000000000000000000000000000000000000B' as `0x${string}`
const WALLET_C = '0x000000000000000000000000000000000000000C' as `0x${string}`

test('computeApprovalDiff identifies wallets added and removed between operator sets', () => {
  const before = [{ address: WALLET_A }, { address: WALLET_B }]
  const after = [{ address: WALLET_B }, { address: WALLET_C }]
  const diff = computeApprovalDiff(before, after)
  assert.deepEqual(diff.added.map(a => a.toLowerCase()), [WALLET_C.toLowerCase()])
  assert.deepEqual(diff.removed.map(a => a.toLowerCase()), [WALLET_A.toLowerCase()])
})

test('computeApprovalDiff returns empty arrays when sets match', () => {
  const before = [{ address: WALLET_A }, { address: WALLET_B }]
  const after = [{ address: WALLET_B }, { address: WALLET_A }]
  const diff = computeApprovalDiff(before, after)
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
})

test('computeApprovalDiff is case-insensitive on the input addresses', () => {
  const before = [{ address: WALLET_A.toLowerCase() }]
  const after = [{ address: WALLET_A.toUpperCase().replace('0X', '0x') }]
  const diff = computeApprovalDiff(before, after)
  assert.deepEqual(diff.added, [])
  assert.deepEqual(diff.removed, [])
})

test('fixPlanRequiresOwnerWallet is true only when there are missing or stale approvals', () => {
  assert.equal(
    fixPlanRequiresOwnerWallet({ identityAgentId: '1', ensName: 'a.eth', items: [] }),
    false,
  )
  assert.equal(
    fixPlanRequiresOwnerWallet({ identityAgentId: '1', ensName: undefined, items: [{ kind: 'no-ens' }] }),
    false,
  )
  assert.equal(
    fixPlanRequiresOwnerWallet({
      identityAgentId: '1',
      ensName: 'a.eth',
      items: [{ kind: 'missing-approval', address: WALLET_A }],
    }),
    true,
  )
  assert.equal(
    fixPlanRequiresOwnerWallet({
      identityAgentId: '1',
      ensName: 'a.eth',
      items: [{ kind: 'stale-approval', address: WALLET_A }],
    }),
    true,
  )
})

test('describeFixPlanItem produces user-readable messages for each kind', () => {
  assert.match(describeFixPlanItem({ kind: 'no-ens' }), /advanced mode requires an ENS subdomain/i)
  assert.match(describeFixPlanItem({ kind: 'no-resolver' }), /no resolver/i)
  assert.match(
    describeFixPlanItem({ kind: 'missing-approval', address: WALLET_A }),
    /no onchain resolver approval/i,
  )
  assert.match(
    describeFixPlanItem({ kind: 'stale-approval', address: WALLET_A }),
    /no longer matches/i,
  )
})
