import type { Hex } from 'viem'
import { addressFromPrivateKey, validatePrivateKey } from '../identity/crypto/eth.js'

export const OPERATOR_KEY_ENV = 'ETHAGENT_OPERATOR_KEY'

export type OperatorKeyResult =
  | { ok: true; key: Hex; address: string }
  | { ok: false; reason: 'missing' | 'invalid' }

export function readOperatorKey(env: NodeJS.ProcessEnv = process.env): OperatorKeyResult {
  const raw = env[OPERATOR_KEY_ENV]?.trim()
  delete env[OPERATOR_KEY_ENV]
  if (!raw) return { ok: false, reason: 'missing' }
  if (!validatePrivateKey(raw)) return { ok: false, reason: 'invalid' }
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  const key = `0x${hex.toLowerCase()}` as Hex
  return { ok: true, key, address: addressFromPrivateKey(key) }
}

export const INVALID_OPERATOR_KEY_MESSAGE =
  `${OPERATOR_KEY_ENV} is not a valid secp256k1 private key (expected 32 bytes of hex, non-zero, below the curve order).`
