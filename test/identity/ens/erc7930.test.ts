import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeInteroperableAddress } from '../../../src/identity/ens/erc7930.js'

test('encodes the ENSIP-25 spec example for mainnet ERC-8004 agent registry', () => {
  const encoded = encodeInteroperableAddress({
    chainId: 1,
    address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  })
  assert.equal(encoded, '0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432')
})

test('encodes a multi-byte chain reference for Base mainnet', () => {
  const encoded = encodeInteroperableAddress({
    chainId: 8453,
    address: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  })
  assert.equal(encoded, '0x0001000002210514' + '8004a169fb4a3325136eb29fa0ceb6d2e539a432')
})

test('encodes a three-byte chain reference for Sepolia', () => {
  const encoded = encodeInteroperableAddress({
    chainId: 11155111,
    address: '0x0000000000000000000000000000000000000001',
  })
  assert.equal(encoded, '0x0001000003aa36a7140000000000000000000000000000000000000001')
})

test('lowercases the address bytes deterministically', () => {
  const upper = encodeInteroperableAddress({
    chainId: 1,
    address: '0x8004A169FB4A3325136EB29FA0CEB6D2E539A432',
  })
  const lower = encodeInteroperableAddress({
    chainId: 1,
    address: '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432',
  })
  assert.equal(upper, lower)
})

test('rejects non-positive chainId', () => {
  assert.throws(() => encodeInteroperableAddress({ chainId: 0, address: '0x0000000000000000000000000000000000000001' }), /invalid chainId/)
  assert.throws(() => encodeInteroperableAddress({ chainId: -1, address: '0x0000000000000000000000000000000000000001' }), /invalid chainId/)
})

test('rejects malformed addresses', () => {
  assert.throws(
    () => encodeInteroperableAddress({ chainId: 1, address: '0xdeadbeef' as `0x${string}` }),
    /invalid address/,
  )
})
