import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import crypto from 'node:crypto'

type RecoverableSecp256k1 = typeof secp256k1 & {
  recoverPublicKey: (signature: Uint8Array, message: Uint8Array) => Uint8Array
}

const HEX_RE = /^(0x)?[0-9a-fA-F]+$/
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/
const SIG_RE = /^0x[0-9a-fA-F]{130}$/

function stripHex(input: string): string {
  return input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input
}

function hexToBytes(hex: string): Uint8Array {
  const stripped = stripHex(hex)
  if (stripped.length % 2 !== 0) throw new Error('hex string has odd length')
  const out = new Uint8Array(stripped.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex')
    out[i] = byte
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function ethereumMessageDigest(message: string | Uint8Array): Uint8Array {
  const data = typeof message === 'string' ? new TextEncoder().encode(message) : message
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${data.length}`)
  const payload = new Uint8Array(prefix.length + data.length)
  payload.set(prefix, 0)
  payload.set(data, prefix.length)
  return keccak_256(payload)
}

function addressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = publicKey.length === 65
    ? publicKey
    : secp256k1.Point.fromBytes(publicKey).toBytes(false)
  const hash = keccak_256(uncompressed.subarray(1))
  const addrBytes = hash.subarray(-20)
  return toChecksumAddress('0x' + bytesToHex(addrBytes))
}

export function generatePrivateKey(): string {
  while (true) {
    const bytes = crypto.randomBytes(32)
    const hex = bytes.toString('hex')
    if (validatePrivateKey(hex)) return `0x${hex}`
  }
}

export function validatePrivateKey(input: string): boolean {
  if (typeof input !== 'string') return false
  const stripped = stripHex(input.trim())
  if (stripped.length !== 64) return false
  if (!HEX_RE.test(stripped)) return false
  let allZero = true
  for (let i = 0; i < stripped.length; i += 1) {
    if (stripped[i] !== '0') { allZero = false; break }
  }
  if (allZero) return false
  try {
    const bytes = hexToBytes(stripped)
    const n = BigInt('0x' + stripped)
    if (n >= secp256k1.Point.Fn.ORDER) return false
    secp256k1.getPublicKey(bytes, false)
    return true
  } catch {
    return false
  }
}

export function addressFromPrivateKey(input: string): string {
  if (!validatePrivateKey(input)) throw new Error('invalid private key')
  const bytes = hexToBytes(stripHex(input.trim()))
  const pub = secp256k1.getPublicKey(bytes, false)
  return addressFromPublicKey(pub)
}

export function toChecksumAddress(address: string): string {
  if (!ADDR_RE.test(address)) throw new Error('invalid address')
  const lower = address.slice(2).toLowerCase()
  const hashHex = bytesToHex(keccak_256(new TextEncoder().encode(lower)))
  let out = '0x'
  for (let i = 0; i < lower.length; i += 1) {
    const ch = lower[i]!
    if (ch >= 'a' && ch <= 'f') {
      out += Number.parseInt(hashHex[i]!, 16) >= 8 ? ch.toUpperCase() : ch
    } else {
      out += ch
    }
  }
  return out
}

export function signMessage(privateKey: string, message: string | Uint8Array): string {
  if (!validatePrivateKey(privateKey)) throw new Error('invalid private key')
  const sk = hexToBytes(stripHex(privateKey.trim()))
  const digest = ethereumMessageDigest(message)
  const sig = secp256k1.sign(digest, sk, { prehash: false })
  const compact = sig.toBytes('compact')
  const r = compact.subarray(0, 32)
  const s = compact.subarray(32, 64)
  const v = 27 + (sig.recovery ?? 0)
  const out = new Uint8Array(65)
  out.set(r, 0)
  out.set(s, 32)
  out[64] = v
  return '0x' + bytesToHex(out)
}

export function recoverAddressFromSignature(message: string | Uint8Array, signature: string): string {
  if (!SIG_RE.test(signature)) throw new Error('invalid signature')
  const bytes = hexToBytes(stripHex(signature))
  const v = bytes[64]!
  const recovery = v >= 27 ? v - 27 : v
  if (recovery < 0 || recovery > 3) throw new Error('invalid recovery id')
  const recovered = new Uint8Array(65)
  recovered[0] = recovery
  recovered.set(bytes.subarray(0, 64), 1)
  const publicKey = (secp256k1 as RecoverableSecp256k1).recoverPublicKey(
    recovered,
    ethereumMessageDigest(message),
  )
  return addressFromPublicKey(publicKey)
}
