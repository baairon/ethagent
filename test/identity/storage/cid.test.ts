import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { base32, base58 } from '@scure/base'
import { assertCidMatchesContent, CidContentMismatchError } from '../../../src/identity/storage/cid.js'

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest())
}

function cidV0(content: Uint8Array): string {
  const multihash = new Uint8Array([0x12, 0x20, ...sha256(content)])
  return base58.encode(multihash)
}

function cidV1Sha256(content: Uint8Array): string {
  const multihash = new Uint8Array([0x12, 0x20, ...sha256(content)])
  const cidBytes = new Uint8Array([0x01, 0x55, ...multihash])
  return 'b' + base32.encode(cidBytes).toLowerCase().replace(/=+$/, '')
}

function cidV1DagPb(content: Uint8Array): string {
  const multihash = new Uint8Array([0x12, 0x20, ...sha256(content)])
  const cidBytes = new Uint8Array([0x01, 0x70, ...multihash])
  return 'b' + base32.encode(cidBytes).toLowerCase().replace(/=+$/, '')
}

function cidV1Sha1(): string {
  const multihash = new Uint8Array([0x11, 0x14, ...new Uint8Array(20)])
  const cidBytes = new Uint8Array([0x01, 0x55, ...multihash])
  return 'b' + base32.encode(cidBytes).toLowerCase().replace(/=+$/, '')
}

const content = new TextEncoder().encode('hello ethagent continuity snapshot')
const tampered = new TextEncoder().encode('hello ethagent continuity snapsh0t')

test('accepts content that matches a raw-codec CIDv1', () => {
  assert.doesNotThrow(() => assertCidMatchesContent(cidV1Sha256(content), content))
})

test('rejects tampered content for a raw-codec CIDv1', () => {
  assert.throws(() => assertCidMatchesContent(cidV1Sha256(content), tampered), CidContentMismatchError)
})

test('skips verification for a CIDv0 (always dag-pb; its digest is not sha256 of the raw bytes)', () => {
  assert.doesNotThrow(() => assertCidMatchesContent(cidV0(content), content))
  assert.doesNotThrow(() => assertCidMatchesContent(cidV0(content), tampered))
})

test('skips verification for a dag-pb CIDv1 (default Pinata shape) instead of false-rejecting', () => {
  assert.doesNotThrow(() => assertCidMatchesContent(cidV1DagPb(content), content))
  assert.doesNotThrow(() => assertCidMatchesContent(cidV1DagPb(content), tampered))
})

test('skips verification for an unparseable CID rather than blocking', () => {
  assert.doesNotThrow(() => assertCidMatchesContent('bafy-not-a-real-cid', content))
  assert.doesNotThrow(() => assertCidMatchesContent('', content))
})

test('skips verification for a non-sha256 multihash', () => {
  assert.doesNotThrow(() => assertCidMatchesContent(cidV1Sha1(), tampered))
})
