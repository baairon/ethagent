import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { addressFromPrivateKey, signMessage } from '../../../src/identity/crypto/eth.js'
import {
  createWalletRestoreAccessChallenge,
  createWalletRestoreAccessKey,
} from '../../../src/identity/continuity/envelope.js'
import {
  normalizeApprovedOperatorWallets,
  removeApprovedOperatorWallet,
} from '../../../src/identity/manager/shared/operatorWallets.js'

const operatorKey = '0x1000000000000000000000000000000000000000000000000000000000000001'
const otherKey = '0x2000000000000000000000000000000000000000000000000000000000000002'
const operator = getAddress(addressFromPrivateKey(operatorKey))
const other = getAddress(addressFromPrivateKey(otherKey))
const owner = getAddress('0x000000000000000000000000000000000000c01d')

const registry = {
  chainId: 8453,
  identityRegistryAddress: getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'),
}
const token = { ...registry, agentId: '42' }

test('wallet restore access challenge binds registry, token, owner, operator wallet, and epoch', () => {
  const challenge = createWalletRestoreAccessChallenge({
    token,
    ownerAddress: owner,
    walletAddress: operator,
    accessEpoch: 3,
  })

  assert.match(challenge, /^Authorize Wallet Restore Access\n/)
  assert.doesNotMatch(challenge, /^ethagent/i)
  assert.match(challenge, /ERC-8004 Token ID: 42/)
  assert.match(challenge, new RegExp(`Owner: ${owner}`))
  assert.match(challenge, new RegExp(`Wallet: ${operator}`))
  assert.match(challenge, /Access Epoch: 3/)
  assert.match(challenge, /restore key/)
  assert.match(challenge, /no transaction, spending, or approvals/)
})

test('approved operator wallets normalize restore access keys', () => {
  const challenge = createWalletRestoreAccessChallenge({
    token,
    ownerAddress: owner,
    walletAddress: operator,
    accessEpoch: 1,
  })
  const restoreAccessKey = createWalletRestoreAccessKey({
    token,
    ownerAddress: owner,
    walletAddress: operator,
    walletSignature: signMessage(operatorKey, challenge),
    accessEpoch: 1,
    createdAt: '2026-05-04T00:00:00.000Z',
  })
  const normalized = normalizeApprovedOperatorWallets([{
    address: operator,
    challenge,
    verifiedAt: '2026-05-04T00:00:00.000Z',
    restoreAccessKey,
  }])

  assert.equal(normalized[0]?.address, operator)
  assert.equal(normalized[0]?.restoreAccessKey?.address, operator)
  assert.equal(normalized[0]?.restoreAccessKey?.kemPublicKey, restoreAccessKey.kemPublicKey)
})

test('approved operator wallets normalize legacy strings and proof records', () => {
  const normalized = normalizeApprovedOperatorWallets([
    operator.toLowerCase(),
    { address: operator, verifiedAt: 'ignored duplicate' },
    { address: other, challenge: 'challenge', verifiedAt: '2026-05-04T00:00:00.000Z' },
    'not-an-address',
  ])

  assert.deepEqual(normalized.map(item => item.address), [operator, other])
  assert.equal(normalized[1]?.verifiedAt, '2026-05-04T00:00:00.000Z')
})

test('approved operator wallets ignore stray legacy signature field on input', () => {
  const input = [
    { address: operator, signature: signMessage(operatorKey, 'challenge'), verifiedAt: '2026-05-04T00:00:00.000Z' },
  ]
  const normalized = normalizeApprovedOperatorWallets(input)
  assert.equal(normalized.length, 1)
  assert.equal(normalized[0]?.address, operator)
  assert.equal((normalized[0] as Record<string, unknown> | undefined)?.signature, undefined)
})

test('removing all operator wallets is allowed without specifying active', () => {
  const after = normalizeApprovedOperatorWallets([])
  assert.deepEqual(after, [])
})

test('active operator wallet must be changed before removal', () => {
  assert.throws(
    () => removeApprovedOperatorWallet([operator], operator, operator),
    /set another active operator wallet before removing this wallet/i,
  )
  assert.deepEqual(removeApprovedOperatorWallet([operator, other], other, operator).map(item => item.address), [operator])
})

test('v2 challenge titles vary by purpose and bump the Version line', () => {
  const ownerProof = createWalletRestoreAccessChallenge({ token, ownerAddress: owner, walletAddress: operator, accessEpoch: 1, purpose: 'operator-proof' })
  assert.match(ownerProof, /^Authorize Operator Wallet Restore Access\n/)
  assert.match(ownerProof, /Version: 3$/)

  const clearEns = createWalletRestoreAccessChallenge({ token, ownerAddress: owner, walletAddress: operator, accessEpoch: 1, purpose: 'clear-ens-snapshot' })
  assert.match(clearEns, /^Unlink ENS from Agent\n/)
  assert.match(clearEns, /No onchain ENS records change\./)
  assert.match(clearEns, /Version: 3$/)

  const profile = createWalletRestoreAccessChallenge({ token, ownerAddress: owner, walletAddress: operator, accessEpoch: 1, purpose: 'update-profile-snapshot' })
  assert.match(profile, /^Update Public Profile Snapshot Key\n/)
  assert.doesNotMatch(profile, /Authorize Wallet Restore Access/)
})

test('legacy no-purpose challenge keeps Authorize Wallet Restore Access wording', () => {
  const v1 = createWalletRestoreAccessChallenge({ token, ownerAddress: owner, walletAddress: operator, accessEpoch: 1 })
  assert.match(v1, /^Authorize Wallet Restore Access\n/)
  assert.match(v1, /Action: create a restore key for encrypted identity snapshots/)
  assert.match(v1, /Version: 2$/)
})

test('access key created with a purpose stores the v2 challenge in its slot', () => {
  const challenge = createWalletRestoreAccessChallenge({ token, ownerAddress: owner, walletAddress: operator, accessEpoch: 7, purpose: 'operator-proof' })
  const key = createWalletRestoreAccessKey({
    token,
    ownerAddress: owner,
    walletAddress: operator,
    walletSignature: signMessage(operatorKey, challenge),
    accessEpoch: 7,
    createdAt: '2026-05-04T00:00:00.000Z',
    purpose: 'operator-proof',
  })
  assert.equal(key.challenge, challenge)
  assert.match(key.challenge, /^Authorize Operator Wallet Restore Access\n/)
})
