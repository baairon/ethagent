import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, namehash, parseAbi } from 'viem'
import {
  encodeApprove,
  encodeApprovalRevoke,
} from '../../../src/identity/ens/resolverDelegation.js'

const RESOLVER_ABI = parseAbi([
  'function approve(bytes32 node, address delegate, bool approved)',
])

const SUBDOMAIN = 'agent1.alice.eth'
const NODE = namehash(SUBDOMAIN)
const OPERATOR_WALLET = '0x000000000000000000000000000000000000bEEF' as `0x${string}`

test('encodeApprove builds calldata for resolver.approve(node, operatorWallet, true)', () => {
  const data = encodeApprove(NODE, OPERATOR_WALLET)
  const decoded = decodeFunctionData({ abi: RESOLVER_ABI, data })
  assert.equal(decoded.functionName, 'approve')
  const args = decoded.args as readonly [`0x${string}`, `0x${string}`, boolean]
  assert.equal(args[0], NODE)
  assert.equal(args[1].toLowerCase(), OPERATOR_WALLET.toLowerCase())
  assert.equal(args[2], true)
})

test('encodeApprovalRevoke builds calldata for resolver.approve(node, operatorWallet, false)', () => {
  const data = encodeApprovalRevoke(NODE, OPERATOR_WALLET)
  const decoded = decodeFunctionData({ abi: RESOLVER_ABI, data })
  assert.equal(decoded.functionName, 'approve')
  const args = decoded.args as readonly [`0x${string}`, `0x${string}`, boolean]
  assert.equal(args[0], NODE)
  assert.equal(args[1].toLowerCase(), OPERATOR_WALLET.toLowerCase())
  assert.equal(args[2], false)
})
