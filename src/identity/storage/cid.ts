import { createHash, timingSafeEqual } from 'node:crypto'
import { base32, base58 } from '@scure/base'

const SHA2_256_CODE = 0x12
const SHA2_256_LEN = 0x20
// IPFS codecs. We can only recompute a content hash for raw-leaf blocks; dag-pb/UnixFS
// CIDs hash the protobuf-wrapped block, not the file bytes `cat` returns, so verifying
// those against sha256(content) would falsely reject every real fetch.
const RAW_CODEC = 0x55
const DAG_PB_CODEC = 0x70

export class CidContentMismatchError extends Error {
  readonly cid: string
  constructor(cid: string) {
    super(`Downloaded content does not match its CID (${cid}); the storage gateway may have returned the wrong data.`)
    this.name = 'CidContentMismatchError'
    this.cid = cid
  }
}

type Multihash = { codec: number; code: number; digest: Uint8Array }

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let pos = offset
  for (;;) {
    const byte = bytes[pos++]
    if (byte === undefined) throw new Error('varint overran buffer')
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 35) throw new Error('varint too long')
  }
  return { value, next: pos }
}

/**
 * Extract the multihash (hash code + digest) from a CIDv0 (base58btc `Qm…`) or a
 * base32 multibase CIDv1 (`b…`). Returns null for any format we cannot decode, so
 * callers can skip verification rather than block a legitimate fetch.
 */
function multihashFromCid(cid: string): Multihash | null {
  const trimmed = cid.trim()
  if (!trimmed) return null
  try {
    if (trimmed.startsWith('Qm') && trimmed.length === 46) {
      const mh = base58.decode(trimmed)
      const code = mh[0]
      const len = mh[1]
      if (code === undefined || len === undefined) return null
      // CIDv0 is always dag-pb/UnixFS by definition.
      return { codec: DAG_PB_CODEC, code, digest: mh.slice(2, 2 + len) }
    }
    if (trimmed[0] === 'b' || trimmed[0] === 'B') {
      let body = trimmed.slice(1).toUpperCase()
      while (body.length % 8 !== 0) body += '='
      const bytes = base32.decode(body)
      let pos = 0
      const version = readVarint(bytes, pos); pos = version.next
      if (version.value !== 1) return null
      const codec = readVarint(bytes, pos); pos = codec.next
      const code = readVarint(bytes, pos); pos = code.next
      const len = readVarint(bytes, pos); pos = len.next
      return { codec: codec.value, code: code.value, digest: bytes.slice(pos, pos + len.value) }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Verify that downloaded bytes actually hash to their CID before they are trusted, so a
 * gateway cannot substitute different content for a content address. We can only do this
 * for raw-leaf (codec 0x55) sha2-256 CIDs, where the multihash digest is sha256 of the
 * file bytes themselves. dag-pb/UnixFS CIDs (what Kubo and Pinata pin by default) hash the
 * wrapped block, not the raw bytes `cat` returns, so they are skipped rather than falsely
 * rejected; their integrity is still covered by authenticated decryption of the snapshot.
 * Throws CidContentMismatchError only on a real mismatch.
 */
export function assertCidMatchesContent(cid: string, content: Uint8Array): void {
  const mh = multihashFromCid(cid)
  if (!mh) return
  if (mh.codec !== RAW_CODEC) return
  if (mh.code !== SHA2_256_CODE || mh.digest.length !== SHA2_256_LEN) return
  const actual = new Uint8Array(createHash('sha256').update(content).digest())
  if (actual.length !== mh.digest.length || !timingSafeEqual(actual, mh.digest)) {
    throw new CidContentMismatchError(cid)
  }
}
