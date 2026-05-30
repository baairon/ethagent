import { getAddress, isAddress, type Address } from 'viem'
import type { WalletContinuityRestoreAccessKey } from '../../continuity/envelope.js'

export type ApprovedOperatorWalletRecord = {
  address: Address
  challenge?: string
  verifiedAt?: string
  restoreAccessKey?: WalletContinuityRestoreAccessKey
}

export type ApprovedOperatorWalletInput = string | ApprovedOperatorWalletRecord

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function isZeroAddress(addr: string): boolean {
  return addr.toLowerCase() === ZERO_ADDRESS
}

export function normalizeApprovedOperatorWallets(input: unknown): ApprovedOperatorWalletRecord[] {
  if (!Array.isArray(input)) return []
  const out: ApprovedOperatorWalletRecord[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const parsed = parseApprovedOperatorWalletRecord(item)
    if (!parsed) continue
    const key = parsed.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(parsed)
  }
  return out
}

export function mergeApprovedOperatorWallets(
  existing: unknown,
  additions: unknown,
  options?: { walletAddress?: string },
): ApprovedOperatorWalletRecord[] {
  let out = normalizeApprovedOperatorWallets(existing)
  for (const record of normalizeApprovedOperatorWallets(additions)) {
    out = upsertApprovedOperatorWallet(out, record, options)
  }
  return out
}

export function upsertApprovedOperatorWallet(
  existing: unknown,
  record: ApprovedOperatorWalletInput,
  options?: { walletAddress?: string },
): ApprovedOperatorWalletRecord[] {
  const parsed = parseApprovedOperatorWalletRecord(record)
  if (!parsed) throw new Error('Approved operator wallet must include a valid address')
  if (options?.walletAddress && options.walletAddress.trim()) {
    if (!isAddress(options.walletAddress, { strict: false })) throw new Error('Owner address is invalid')
    if (parsed.address.toLowerCase() === options.walletAddress.toLowerCase()) {
      throw new Error('Operator wallet must be different from the owner wallet')
    }
  }
  const records = normalizeApprovedOperatorWallets(existing)
  const key = parsed.address.toLowerCase()
  const index = records.findIndex(item => item.address.toLowerCase() === key)
  if (index === -1) return [...records, parsed]
  const next = records.slice()
  next[index] = { ...records[index], ...parsed, address: parsed.address }
  return next
}

export function removeApprovedOperatorWallet(
  existing: unknown,
  address: string,
  activeOperatorAddress?: string,
): ApprovedOperatorWalletRecord[] {
  if (!isAddress(address, { strict: false })) throw new Error('Operator wallet address is invalid')
  const target = getAddress(address)
  if (activeOperatorAddress && activeOperatorAddress.toLowerCase() === target.toLowerCase()) {
    throw new Error('Set another active operator wallet before removing this wallet')
  }
  return normalizeApprovedOperatorWallets(existing).filter(item => item.address.toLowerCase() !== target.toLowerCase())
}

export function assertActiveOperatorIsApproved(
  records: unknown,
  activeOperatorAddress: string | undefined,
): Address | undefined {
  if (!activeOperatorAddress || !activeOperatorAddress.trim()) return undefined
  if (!isAddress(activeOperatorAddress, { strict: false })) throw new Error('Active operator wallet address is invalid')
  const active = getAddress(activeOperatorAddress)
  const approved = normalizeApprovedOperatorWallets(records)
  if (!approved.some(item => item.address.toLowerCase() === active.toLowerCase())) {
    throw new Error('Active operator wallet must be one of the approved operator wallets')
  }
  return active
}

function parseApprovedOperatorWalletRecord(input: unknown): ApprovedOperatorWalletRecord | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!isAddress(trimmed, { strict: false })) return null
    if (isZeroAddress(trimmed)) return null
    return { address: getAddress(trimmed) }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  const rawAddress = obj.address
  if (typeof rawAddress !== 'string' || !isAddress(rawAddress, { strict: false })) return null
  if (isZeroAddress(rawAddress)) return null
  const challenge = typeof obj.challenge === 'string' && obj.challenge.trim() ? obj.challenge : undefined
  const verifiedAt = typeof obj.verifiedAt === 'string' && obj.verifiedAt.trim() ? obj.verifiedAt : undefined
  return {
    address: getAddress(rawAddress),
    ...(challenge ? { challenge } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(parseRestoreAccessKey(obj.restoreAccessKey) ? { restoreAccessKey: parseRestoreAccessKey(obj.restoreAccessKey)! } : {}),
  }
}

function parseRestoreAccessKey(input: unknown): WalletContinuityRestoreAccessKey | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Partial<WalletContinuityRestoreAccessKey>
  if (typeof obj.address !== 'string' || !isAddress(obj.address, { strict: false })) return undefined
  if (typeof obj.challenge !== 'string' || !obj.challenge.trim()) return undefined
  if (typeof obj.salt !== 'string' || !obj.salt.trim()) return undefined
  if (typeof obj.kemPublicKey !== 'string' || !obj.kemPublicKey.trim()) return undefined
  return {
    address: getAddress(obj.address),
    challenge: obj.challenge,
    salt: obj.salt,
    kemPublicKey: obj.kemPublicKey,
    ...(typeof obj.createdAt === 'string' && obj.createdAt.trim() ? { createdAt: obj.createdAt } : {}),
  }
}
