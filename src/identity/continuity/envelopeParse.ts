import crypto from 'node:crypto'
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js'
import { recoverAddressFromSignature, toChecksumAddress } from '../crypto/eth.js'
import type { TransferSnapshotMetadata } from '../../storage/config.js'
import { normalizeContinuitySnapshotToken } from './snapshotToken.js'
import { CONTINUITY_SNAPSHOT_ENVELOPE_VERSION } from './envelopeVersion.js'
import {
  continuityAadFor,
  deriveContinuityAesKey,
  deriveContinuityKemSeed,
  deriveTransferSlotKey,
  deriveWalletRestoreKemSeed,
  deriveWalletSlotAesKey,
  fromBase64,
  sha256Hex,
  toBase64,
  transferPayloadAadFor,
  transferSlotAadFor,
  walletPayloadAadFor,
  walletSlotAadFor,
} from './envelopeCrypto.js'
import {
  normalizeContinuityPayload,
  normalizeTransferSlot,
  normalizeWalletSlot,
} from './payloadNormalization.js'
import {
  ContinuitySnapshotOwnerMismatchError,
  ContinuitySnapshotRestoreSlotMissingError,
  ContinuityTransferSnapshotTargetMismatchError,
  type ContinuitySnapshotEnvelope,
  type ContinuitySnapshotPayload,
  type TransferContinuitySnapshotEnvelope,
  type TransferContinuitySnapshotSlot,
  type WalletContinuitySnapshotEnvelope,
  type WalletContinuitySnapshotSlot,
} from './envelopeTypes.js'

const MAX_WALLET_RESTORE_SLOTS = 256

export function restoreContinuitySnapshotEnvelope(args: {
  envelope: ContinuitySnapshotEnvelope
  walletSignature: string
  currentOwnerAddress?: string
}): ContinuitySnapshotPayload {
  const envelope = normalizeContinuitySnapshotEnvelope(args.envelope)
  if (isWalletContinuitySnapshotEnvelope(envelope)) {
    return restoreWalletContinuitySnapshotEnvelope({
      envelope,
      walletSignature: args.walletSignature,
      currentOwnerAddress: args.currentOwnerAddress,
    })
  }
  if (isTransferContinuitySnapshotEnvelope(envelope)) {
    return restoreTransferContinuitySnapshotEnvelope({
      envelope,
      walletSignature: args.walletSignature,
      currentOwnerAddress: args.currentOwnerAddress,
    })
  }

  assertSignatureForAddress(envelope.challenge, args.walletSignature, envelope.ownerAddress)

  const salt = fromBase64(envelope.salt)
  const kemSeed = deriveContinuityKemSeed(args.walletSignature, salt, envelope.ownerAddress)
  const kemKeys = ml_kem1024.keygen(kemSeed)
  const expectedPublicKey = toBase64(kemKeys.publicKey)
  if (expectedPublicKey !== envelope.kemPublicKey) {
    throw new Error('Wallet signature does not match this continuity snapshot')
  }

  const sharedSecret = ml_kem1024.decapsulate(fromBase64(envelope.kemCiphertext), kemKeys.secretKey)
  const key = deriveContinuityAesKey(args.walletSignature, sharedSecret, salt, envelope.ownerAddress)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromBase64(envelope.nonce))
  decipher.setAAD(continuityAadFor(envelope.ownerAddress, envelope.createdAt))
  decipher.setAuthTag(fromBase64(envelope.tag))

  let decoded: unknown
  try {
    const plaintext = Buffer.concat([
      decipher.update(fromBase64(envelope.ciphertext)),
      decipher.final(),
    ]).toString('utf8')
    decoded = JSON.parse(plaintext)
  } catch {
    throw new Error('Could not decrypt continuity snapshot with the supplied wallet signature')
  }

  const payload = normalizeContinuityPayload(decoded)
  assertPayloadMatchesEnvelope(payload, envelope.ownerAddress, envelope.createdAt)
  return payload
}

export function assertContinuitySnapshotOwner(envelope: ContinuitySnapshotEnvelope, currentOwner: string): void {
  const normalized = normalizeContinuitySnapshotEnvelope(envelope)
  const owner = toChecksumAddress(currentOwner)
  if (isWalletContinuitySnapshotEnvelope(normalized)) {
    const snapshotOwner = toChecksumAddress(normalized.ownerAddress)
    if (snapshotOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new ContinuitySnapshotOwnerMismatchError(snapshotOwner, owner)
    }
    return
  }
  if (isTransferContinuitySnapshotEnvelope(normalized)) {
    const snapshotOwner = toChecksumAddress(normalized.ownerAddress)
    const targetOwner = toChecksumAddress(normalized.targetAddress)
    if (
      owner.toLowerCase() !== snapshotOwner.toLowerCase()
      && owner.toLowerCase() !== targetOwner.toLowerCase()
    ) {
      throw new ContinuityTransferSnapshotTargetMismatchError(snapshotOwner, targetOwner, owner)
    }
    return
  }
  const snapshotOwner = toChecksumAddress(normalized.ownerAddress)
  if (snapshotOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new ContinuitySnapshotOwnerMismatchError(snapshotOwner, owner)
  }
}

export function serializeContinuitySnapshotEnvelope(envelope: ContinuitySnapshotEnvelope): string {
  return JSON.stringify(normalizeContinuitySnapshotEnvelope(envelope), null, 2)
}

export function parseContinuitySnapshotEnvelope(raw: string | Uint8Array): ContinuitySnapshotEnvelope {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  const parsed = JSON.parse(text) as unknown
  return normalizeContinuitySnapshotEnvelope(parsed)
}

export function transferSnapshotMetadataFromEnvelope(
  envelope: ContinuitySnapshotEnvelope,
): TransferSnapshotMetadata | null {
  const normalized = normalizeContinuitySnapshotEnvelope(envelope)
  if (!isTransferContinuitySnapshotEnvelope(normalized)) return null
  const slotCount = [normalized.slots.owner, normalized.slots.target]
    .filter(slot => Boolean(slot?.encryptedKey && slot.address))
    .length
  if (slotCount < 2) return null
  return {
    kind: 'dual-wallet',
    senderAddress: normalized.ownerAddress,
    receiverAddress: normalized.targetAddress,
    ...(normalized.targetHandle ? { receiverHandle: normalized.targetHandle } : {}),
    slotCount,
    createdAt: normalized.createdAt,
  }
}

export function walletContinuitySnapshotSlotForAddress(
  envelope: ContinuitySnapshotEnvelope,
  address: string,
): WalletContinuitySnapshotSlot | null {
  const normalized = normalizeContinuitySnapshotEnvelope(envelope)
  if (!isWalletContinuitySnapshotEnvelope(normalized)) return null
  const checksum = toChecksumAddress(address)
  return normalized.slots.find(slot => slot.address.toLowerCase() === checksum.toLowerCase()) ?? null
}

export function findRestorableAddressForSnapshot(
  envelope: ContinuitySnapshotEnvelope,
  candidates: ReadonlyArray<string>,
): string | null {
  const normalized = normalizeContinuitySnapshotEnvelope(envelope)
  const seen = new Set<string>()
  const lowerCandidates: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    const lower = candidate.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    lowerCandidates.push(lower)
  }
  if (lowerCandidates.length === 0) return null
  if (isWalletContinuitySnapshotEnvelope(normalized)) {
    for (const slot of normalized.slots) {
      if (lowerCandidates.includes(slot.address.toLowerCase())) return toChecksumAddress(slot.address)
    }
    return null
  }
  if (isTransferContinuitySnapshotEnvelope(normalized)) {
    const ownerLower = normalized.ownerAddress.toLowerCase()
    const targetLower = normalized.targetAddress.toLowerCase()
    if (lowerCandidates.includes(ownerLower)) return toChecksumAddress(normalized.ownerAddress)
    if (lowerCandidates.includes(targetLower)) return toChecksumAddress(normalized.targetAddress)
    return null
  }
  const ownerLower = normalized.ownerAddress.toLowerCase()
  return lowerCandidates.includes(ownerLower) ? toChecksumAddress(normalized.ownerAddress) : null
}

export function isWalletContinuitySnapshotEnvelope(input: unknown): input is WalletContinuitySnapshotEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const obj = input as Partial<WalletContinuitySnapshotEnvelope> & { crypto?: Partial<WalletContinuitySnapshotEnvelope['crypto']> }
  return obj.version === 1
    && obj.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
    && typeof obj.ownerAddress === 'string'
    && typeof obj.createdAt === 'string'
    && !!obj.token
    && typeof obj.accessEpoch === 'number'
    && typeof obj.accessManifestHash === 'string'
    && obj.crypto?.decryptsWith === 'wallet-signature-slots'
    && typeof obj.payloadNonce === 'string'
    && typeof obj.payloadCiphertext === 'string'
    && typeof obj.payloadTag === 'string'
    && typeof obj.payloadHash === 'string'
    && Array.isArray(obj.slots)
}

export function isTransferContinuitySnapshotEnvelope(input: unknown): input is TransferContinuitySnapshotEnvelope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const obj = input as Partial<TransferContinuitySnapshotEnvelope> & { crypto?: Partial<TransferContinuitySnapshotEnvelope['crypto']> }
  return obj.version === 1
    && obj.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
    && typeof obj.ownerAddress === 'string'
    && typeof obj.createdAt === 'string'
    && typeof obj.challenge === 'string'
    && !!obj.token
    && typeof obj.targetAddress === 'string'
    && obj.crypto?.decryptsWith === 'transfer-signature-slot'
    && typeof obj.payloadNonce === 'string'
    && typeof obj.payloadCiphertext === 'string'
    && typeof obj.payloadTag === 'string'
    && typeof obj.payloadHash === 'string'
    && !!obj.slots
    && !!obj.slots.owner
    && !!obj.slots.target
}

function restoreTransferContinuitySnapshotEnvelope(args: {
  envelope: TransferContinuitySnapshotEnvelope
  walletSignature: string
  currentOwnerAddress?: string
}): ContinuitySnapshotPayload {
  const currentAddress = args.currentOwnerAddress
    ? toChecksumAddress(args.currentOwnerAddress)
    : recoverTransferSlotAddress(args.envelope, args.walletSignature)
  const slot = transferSlotForCurrentOwner(args.envelope, currentAddress)
  assertSignatureForAddress(slot.challenge, args.walletSignature, slot.address)

  let contentKey: Buffer
  try {
    const payloadAad = transferPayloadAadFor(args.envelope)
    const slotKey = deriveTransferSlotKey(args.walletSignature, fromBase64(slot.salt), slot.address, slot.challenge)
    const keyDecipher = crypto.createDecipheriv('aes-256-gcm', slotKey, fromBase64(slot.nonce))
    keyDecipher.setAAD(transferSlotAadFor(slot, payloadAad))
    keyDecipher.setAuthTag(fromBase64(slot.tag))
    contentKey = Buffer.concat([
      keyDecipher.update(fromBase64(slot.encryptedKey)),
      keyDecipher.final(),
    ])
  } catch {
    throw new Error('Could not decrypt transfer snapshot key with the supplied wallet signature')
  }

  let decoded: unknown
  try {
    const payloadAad = transferPayloadAadFor(args.envelope)
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, fromBase64(args.envelope.payloadNonce))
    decipher.setAAD(payloadAad)
    decipher.setAuthTag(fromBase64(args.envelope.payloadTag))
    const plaintext = Buffer.concat([
      decipher.update(fromBase64(args.envelope.payloadCiphertext)),
      decipher.final(),
    ])
    if (sha256Hex(plaintext) !== args.envelope.payloadHash) {
      throw new Error('Transfer snapshot payload hash mismatch')
    }
    decoded = JSON.parse(plaintext.toString('utf8')) as unknown
  } catch {
    throw new Error('Could not decrypt continuity transfer snapshot with the supplied wallet signature')
  }

  const payload = normalizeContinuityPayload(decoded)
  assertPayloadMatchesEnvelope(payload, args.envelope.ownerAddress, args.envelope.createdAt)
  return payload
}

function restoreWalletContinuitySnapshotEnvelope(args: {
  envelope: WalletContinuitySnapshotEnvelope
  walletSignature: string
  currentOwnerAddress?: string
}): ContinuitySnapshotPayload {
  const slot = walletSlotForRestore(args.envelope, args.walletSignature, args.currentOwnerAddress)
  assertSignatureForAddress(slot.challenge, args.walletSignature, slot.address)

  let contentKey: Buffer
  try {
    const salt = fromBase64(slot.salt)
    const kemSeed = deriveWalletRestoreKemSeed(args.walletSignature, salt, slot.address, slot.challenge)
    const kemKeys = ml_kem1024.keygen(kemSeed)
    if (toBase64(kemKeys.publicKey) !== slot.kemPublicKey) {
      throw new Error('Wallet restore key mismatch')
    }
    const sharedSecret = ml_kem1024.decapsulate(fromBase64(slot.kemCiphertext), kemKeys.secretKey)
    const slotKey = deriveWalletSlotAesKey(sharedSecret, salt, slot.address, slot.challenge, args.envelope.accessManifestHash)
    const keyDecipher = crypto.createDecipheriv('aes-256-gcm', slotKey, fromBase64(slot.nonce))
    const payloadAad = walletPayloadAadFor(args.envelope)
    keyDecipher.setAAD(walletSlotAadFor(slot, payloadAad))
    keyDecipher.setAuthTag(fromBase64(slot.tag))
    contentKey = Buffer.concat([
      keyDecipher.update(fromBase64(slot.encryptedKey)),
      keyDecipher.final(),
    ])
  } catch {
    throw new Error('Could not decrypt wallet restore snapshot key with the supplied wallet signature')
  }

  let decoded: unknown
  try {
    const payloadAad = walletPayloadAadFor(args.envelope)
    const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, fromBase64(args.envelope.payloadNonce))
    decipher.setAAD(payloadAad)
    decipher.setAuthTag(fromBase64(args.envelope.payloadTag))
    const plaintext = Buffer.concat([
      decipher.update(fromBase64(args.envelope.payloadCiphertext)),
      decipher.final(),
    ])
    if (sha256Hex(plaintext) !== args.envelope.payloadHash) {
      throw new Error('Wallet restore snapshot payload hash mismatch')
    }
    decoded = JSON.parse(plaintext.toString('utf8')) as unknown
  } catch {
    throw new Error('Could not decrypt wallet restore snapshot with the supplied wallet signature')
  }

  const payload = normalizeContinuityPayload(decoded)
  assertPayloadMatchesEnvelope(payload, args.envelope.ownerAddress, args.envelope.createdAt)
  return payload
}

function walletSlotForRestore(
  envelope: WalletContinuitySnapshotEnvelope,
  walletSignature: string,
  currentOwnerAddress?: string,
): WalletContinuitySnapshotSlot {
  if (currentOwnerAddress) {
    const address = toChecksumAddress(currentOwnerAddress)
    const slot = envelope.slots.find(item => item.address.toLowerCase() === address.toLowerCase())
    if (!slot) throw new ContinuitySnapshotRestoreSlotMissingError(address)
    return slot
  }
  for (const slot of envelope.slots) {
    try {
      const recovered = recoverAddressFromSignature(slot.challenge, walletSignature)
      if (recovered.toLowerCase() === slot.address.toLowerCase()) return slot
    } catch {
    }
  }
  throw new ContinuitySnapshotRestoreSlotMissingError('unknown')
}

function recoverTransferSlotAddress(
  envelope: TransferContinuitySnapshotEnvelope,
  walletSignature: string,
): string {
  for (const slot of [envelope.slots.owner, envelope.slots.target]) {
    try {
      const recovered = recoverAddressFromSignature(slot.challenge, walletSignature)
      if (recovered.toLowerCase() === slot.address.toLowerCase()) return toChecksumAddress(slot.address)
    } catch {
    }
  }
  throw new ContinuityTransferSnapshotTargetMismatchError(envelope.ownerAddress, envelope.targetAddress, 'unknown')
}

function transferSlotForCurrentOwner(
  envelope: TransferContinuitySnapshotEnvelope,
  currentOwner: string,
): TransferContinuitySnapshotSlot {
  if (currentOwner.toLowerCase() === envelope.ownerAddress.toLowerCase()) return envelope.slots.owner
  if (currentOwner.toLowerCase() === envelope.targetAddress.toLowerCase()) return envelope.slots.target
  throw new ContinuityTransferSnapshotTargetMismatchError(envelope.ownerAddress, envelope.targetAddress, currentOwner)
}

export function normalizeContinuitySnapshotEnvelope(input: unknown): ContinuitySnapshotEnvelope {
  if (!isContinuitySnapshotEnvelope(input)) throw new Error('Invalid continuity snapshot envelope')
  if (input.envelopeVersion !== CONTINUITY_SNAPSHOT_ENVELOPE_VERSION) {
    throw new Error('Unsupported continuity snapshot envelope version')
  }
  if (isWalletContinuitySnapshotEnvelope(input)) {
    if (input.crypto.kem !== 'ML-KEM-1024' || input.crypto.aead !== 'AES-256-GCM' || input.crypto.decryptsWith !== 'wallet-signature-slots') {
      throw new Error('Unsupported continuity snapshot crypto suite')
    }
    const ownerAddress = toChecksumAddress(input.ownerAddress)
    const token = normalizeContinuitySnapshotToken(input.token)
    if (input.slots.length > MAX_WALLET_RESTORE_SLOTS) {
      throw new Error('Continuity wallet snapshot has too many restore slots')
    }
    const slots = input.slots.map(normalizeWalletSlot)
    if (slots.length === 0) throw new Error('Continuity wallet snapshot needs at least one slot')
    return {
      ...input,
      ownerAddress,
      token,
      slots,
    }
  }
  if (isTransferContinuitySnapshotEnvelope(input)) {
    if (input.crypto.aead !== 'AES-256-GCM' || input.crypto.decryptsWith !== 'transfer-signature-slot') {
      throw new Error('Unsupported continuity snapshot crypto suite')
    }
    const ownerAddress = toChecksumAddress(input.ownerAddress)
    const targetAddress = toChecksumAddress(input.targetAddress)
    return {
      ...input,
      ownerAddress,
      targetAddress,
      token: normalizeContinuitySnapshotToken(input.token),
      slots: {
        owner: normalizeTransferSlot(input.slots.owner, ownerAddress),
        target: normalizeTransferSlot(input.slots.target, targetAddress),
      },
    }
  }
  if (input.crypto.kem !== 'ML-KEM-1024' || input.crypto.aead !== 'AES-256-GCM') {
    throw new Error('Unsupported continuity snapshot crypto suite')
  }
  return {
    ...input,
    ownerAddress: toChecksumAddress(input.ownerAddress),
  }
}

function isContinuitySnapshotEnvelope(input: unknown): input is ContinuitySnapshotEnvelope {
  if (!input || typeof input !== 'object') return false
  const obj = input as Record<string, unknown> & { walletSignature?: unknown; crypto?: unknown }
  const base = obj.version === 1
    && obj.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
    && typeof obj.ownerAddress === 'string'
    && typeof obj.createdAt === 'string'
    && obj.walletSignature === undefined
    && !!obj.crypto
  if (!base) return false
  if (isWalletContinuitySnapshotEnvelope(input)) return true
  if (isTransferContinuitySnapshotEnvelope(input)) return true
  return typeof obj.challenge === 'string'
    && typeof obj.salt === 'string'
    && typeof obj.kemPublicKey === 'string'
    && typeof obj.kemCiphertext === 'string'
    && typeof obj.nonce === 'string'
    && typeof obj.ciphertext === 'string'
    && typeof obj.tag === 'string'
}

export function assertPayloadMatchesEnvelope(payload: ContinuitySnapshotPayload, ownerAddress: string, createdAt: string): void {
  if (payload.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error('Continuity snapshot owner mismatch')
  }
  if (payload.createdAt !== createdAt) {
    throw new Error('Continuity snapshot timestamp mismatch')
  }
}

export function assertSignatureForAddress(challenge: string, signature: string, address: string): void {
  const recovered = recoverAddressFromSignature(challenge, signature)
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Wallet signature does not match continuity snapshot owner')
  }
}
