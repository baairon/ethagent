import test from 'node:test'
import assert from 'node:assert/strict'
import { compareOperatorSets } from '../../../src/identity/ens/ensAutomation.js'

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const C = '0x3333333333333333333333333333333333333333'

test('compareOperatorSets reports inSync when metadata and resolver match', () => {
  const diff = compareOperatorSets({
    metadataOperators: [{ address: A }, { address: B }],
    resolverDelegates: [A, B],
  })
  assert.equal(diff.inSync, true)
  assert.deepEqual(diff.metadataOnly, [])
  assert.deepEqual(diff.resolverOnly, [])
})

test('compareOperatorSets flags operators present only in metadata', () => {
  const diff = compareOperatorSets({
    metadataOperators: [{ address: A }, { address: B }],
    resolverDelegates: [A],
  })
  assert.equal(diff.inSync, false)
  assert.equal(diff.metadataOnly.length, 1)
  assert.equal(diff.metadataOnly[0]!.toLowerCase(), B.toLowerCase())
  assert.deepEqual(diff.resolverOnly, [])
})

test('compareOperatorSets flags delegates present only on the resolver', () => {
  const diff = compareOperatorSets({
    metadataOperators: [{ address: A }],
    resolverDelegates: [A, C],
  })
  assert.equal(diff.inSync, false)
  assert.deepEqual(diff.metadataOnly, [])
  assert.equal(diff.resolverOnly.length, 1)
  assert.equal(diff.resolverOnly[0]!.toLowerCase(), C.toLowerCase())
})

test('compareOperatorSets flags drift on both sides simultaneously', () => {
  const diff = compareOperatorSets({
    metadataOperators: [{ address: A }, { address: B }],
    resolverDelegates: [A, C],
  })
  assert.equal(diff.inSync, false)
  assert.equal(diff.metadataOnly[0]!.toLowerCase(), B.toLowerCase())
  assert.equal(diff.resolverOnly[0]!.toLowerCase(), C.toLowerCase())
})

test('compareOperatorSets matches addresses regardless of side casing', () => {
  const checksummed = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  const lowered = checksummed.toLowerCase()
  const diff = compareOperatorSets({
    metadataOperators: [{ address: checksummed }],
    resolverDelegates: [lowered],
  })
  assert.equal(diff.inSync, true)
})

test('compareOperatorSets handles empty inputs without errors', () => {
  const diff = compareOperatorSets({ metadataOperators: [], resolverDelegates: [] })
  assert.equal(diff.inSync, true)
  assert.deepEqual(diff.metadataOnly, [])
  assert.deepEqual(diff.resolverOnly, [])
})

test('compareOperatorSets emits checksummed addresses for drift items', () => {
  const lower = A.toLowerCase()
  const diff = compareOperatorSets({
    metadataOperators: [{ address: lower }],
    resolverDelegates: [],
  })
  assert.equal(diff.metadataOnly[0]!, '0x1111111111111111111111111111111111111111')
})
