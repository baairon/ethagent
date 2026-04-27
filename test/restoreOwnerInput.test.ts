import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOwnerHandleInput } from '../src/identity/screens/RestoreFlow.js'

test('restore owner input accepts Ethereum addresses and ENS names', () => {
  assert.equal(validateOwnerHandleInput('0x000000000000000000000000000000000000dEaD'), null)
  assert.equal(validateOwnerHandleInput('bairon.eth'), null)
  assert.equal(validateOwnerHandleInput('sub.name.eth'), null)
})

test('restore owner input rejects arbitrary text before network search', () => {
  assert.equal(validateOwnerHandleInput('name'), 'enter a valid Ethereum address or ENS name')
  assert.equal(validateOwnerHandleInput('0x123'), 'enter a valid Ethereum address or ENS name')
  assert.equal(validateOwnerHandleInput('name.com'), 'enter a valid Ethereum address or ENS name')
  assert.equal(validateOwnerHandleInput('-bad.eth'), 'enter a valid Ethereum address or ENS name')
})
