import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generatePrivateKey,
  validatePrivateKey,
  addressFromPrivateKey,
  toChecksumAddress,
  signMessage,
} from '../src/identity/eth.js'

test('addressFromPrivateKey derives the canonical address for sk=1', () => {
  const pk = '0x0000000000000000000000000000000000000000000000000000000000000001'
  const addr = addressFromPrivateKey(pk)
  assert.equal(addr.toLowerCase(), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf')
})

test('addressFromPrivateKey derives the canonical address for sk=2', () => {
  const pk = '0x0000000000000000000000000000000000000000000000000000000000000002'
  const addr = addressFromPrivateKey(pk)
  assert.equal(addr.toLowerCase(), '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf')
})

test('toChecksumAddress matches EIP-55 reference vectors', () => {
  const vectors = [
    '0x52908400098527886E0F7030069857D2E4169EE7',
    '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
    '0xde709f2102306220921060314715629080e2fb77',
    '0x27b1fdb04752bbc536007a920d24acb045561c26',
    '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
  ]
  for (const v of vectors) {
    assert.equal(toChecksumAddress(v.toLowerCase()), v, `vector mismatch: ${v}`)
    assert.equal(toChecksumAddress(v.toUpperCase().replace('0X', '0x')), v, `upper mismatch: ${v}`)
  }
})

test('validatePrivateKey rejects invalid inputs', () => {
  assert.equal(validatePrivateKey(''), false)
  assert.equal(validatePrivateKey('0x'), false)
  assert.equal(validatePrivateKey('0x' + '0'.repeat(64)), false, 'zero key must be rejected')
  assert.equal(validatePrivateKey('zz' + '0'.repeat(62)), false, 'non-hex must be rejected')
  assert.equal(validatePrivateKey('0x' + '0'.repeat(63)), false, 'odd length must be rejected')
  assert.equal(validatePrivateKey('0x' + 'f'.repeat(64)), false, 'above curve order must be rejected')
})

test('validatePrivateKey accepts valid hex with or without 0x prefix', () => {
  assert.equal(validatePrivateKey('0x' + '1'.repeat(64)), true)
  assert.equal(validatePrivateKey('1'.repeat(64)), true)
})

test('generatePrivateKey produces unique, valid 32-byte hex keys', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 16; i += 1) {
    const pk = generatePrivateKey()
    assert.equal(pk.startsWith('0x'), true)
    assert.equal(pk.length, 66)
    assert.equal(validatePrivateKey(pk), true)
    seen.add(pk)
  }
  assert.equal(seen.size, 16, 'expected 16 unique generated keys')
})

test('signMessage returns a 65-byte hex signature', () => {
  const pk = '0x' + '4'.repeat(64)
  const sig = signMessage(pk, 'hello world')
  assert.equal(sig.startsWith('0x'), true)
  assert.equal(sig.length, 2 + 130)
})
