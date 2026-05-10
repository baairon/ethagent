import test from 'node:test'
import assert from 'node:assert/strict'
import {
  arrayField,
  booleanField,
  numberField,
  objectField,
  stringField,
} from '../../../src/identity/registry/fieldParsers.js'

test('stringField returns non-empty strings, otherwise undefined', () => {
  assert.equal(stringField({ a: 'hello' }, 'a'), 'hello')
  assert.equal(stringField({ a: '' }, 'a'), undefined)
  assert.equal(stringField({ a: 42 }, 'a'), undefined)
  assert.equal(stringField({ a: null }, 'a'), undefined)
  assert.equal(stringField({}, 'a'), undefined)
  assert.equal(stringField(null, 'a'), undefined)
  assert.equal(stringField(undefined, 'a'), undefined)
})

test('numberField returns positive safe integers, otherwise undefined', () => {
  assert.equal(numberField({ a: 1 }, 'a'), 1)
  assert.equal(numberField({ a: Number.MAX_SAFE_INTEGER }, 'a'), Number.MAX_SAFE_INTEGER)
  assert.equal(numberField({ a: 0 }, 'a'), undefined)
  assert.equal(numberField({ a: -1 }, 'a'), undefined)
  assert.equal(numberField({ a: 1.5 }, 'a'), undefined)
  assert.equal(numberField({ a: Number.NaN }, 'a'), undefined)
  assert.equal(numberField({ a: '42' }, 'a'), undefined)
  assert.equal(numberField(null, 'a'), undefined)
})

test('objectField returns plain objects, rejecting arrays/null/primitives', () => {
  const obj = { x: 1 }
  assert.equal(objectField({ a: obj }, 'a'), obj)
  assert.equal(objectField({ a: [1, 2] }, 'a'), null)
  assert.equal(objectField({ a: null }, 'a'), null)
  assert.equal(objectField({ a: 'hello' }, 'a'), null)
  assert.equal(objectField({}, 'a'), null)
  assert.equal(objectField(null, 'a'), null)
})

test('arrayField returns arrays, otherwise null', () => {
  const arr = [1, 2, 3]
  assert.equal(arrayField({ a: arr }, 'a'), arr)
  assert.equal(arrayField({ a: { length: 0 } }, 'a'), null)
  assert.equal(arrayField({ a: 'string' }, 'a'), null)
  assert.equal(arrayField({}, 'a'), null)
  assert.equal(arrayField(null, 'a'), null)
})

test('booleanField returns booleans, otherwise undefined', () => {
  assert.equal(booleanField({ a: true }, 'a'), true)
  assert.equal(booleanField({ a: false }, 'a'), false)
  assert.equal(booleanField({ a: 'true' }, 'a'), undefined)
  assert.equal(booleanField({ a: 1 }, 'a'), undefined)
  assert.equal(booleanField({ a: null }, 'a'), undefined)
  assert.equal(booleanField({}, 'a'), undefined)
  assert.equal(booleanField(null, 'a'), undefined)
})

test('field parsers compose for nested registry payloads', () => {
  const payload: Record<string, unknown> = {
    'x-ethagent': {
      operators: {
        approvedOperatorWallets: [{ address: '0xabc' }],
        restoreAccessEpoch: 5,
        ensName: 'agent.eth',
      },
    },
  }
  const ext = objectField(payload, 'x-ethagent')
  const operators = objectField(ext, 'operators')
  assert.equal(stringField(operators, 'ensName'), 'agent.eth')
  assert.equal(numberField(operators, 'restoreAccessEpoch'), 5)
  const wallets = arrayField(operators, 'approvedOperatorWallets')
  assert.equal(wallets?.length, 1)
})
