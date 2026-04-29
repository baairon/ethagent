import crypto from 'node:crypto'
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js'
import { recoverAddressFromSignature, toChecksumAddress } from '../eth.js'

export const CONTINUITY_SNAPSHOT_ENVELOPE_VERSION = 'ethagent-continuity-snapshot-v1'

export type ContinuityFiles = {
  'SOUL.md': string
  'MEMORY.md': string
}

export type ContinuityTranscriptSummary = {
  sessionId?: string
  createdAt?: string
  summary: string
}

export type ContinuityAgentSnapshot = {
  chainId?: number
  identityRegistryAddress?: string
  agentId?: string
  agentUri?: string
  metadataCid?: string
  name?: string
  description?: string
}

export type ContinuitySnapshotPayload = {
  version: 1
  ownerAddress: string
  createdAt: string
  sequence?: number
  agent: ContinuityAgentSnapshot
  files: ContinuityFiles
  transcript: ContinuityTranscriptSummary[]
  state: Record<string, unknown>
}

export type ContinuitySnapshotEnvelope = {
  version: 1
  envelopeVersion: typeof CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
  ownerAddress: string
  createdAt: string
  challenge: string
  crypto: {
    kem: 'ML-KEM-1024'
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    signature: 'EIP-191'
  }
  salt: string
  kemPublicKey: string
  kemCiphertext: string
  nonce: string
  ciphertext: string
  tag: string
}

export type CreateContinuitySnapshotEnvelopeArgs = {
  ownerAddress: string
  walletSignature: string
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & {
    createdAt?: string
  }
}

export type RestoreContinuitySnapshotEnvelopeArgs = {
  envelope: ContinuitySnapshotEnvelope
  walletSignature: string
}

export class ContinuitySnapshotOwnerMismatchError extends Error {
  constructor(
    readonly snapshotOwner: string,
    readonly currentOwner: string,
  ) {
    super('continuity snapshot is encrypted for another wallet')
    this.name = 'ContinuitySnapshotOwnerMismatchError'
  }
}

export function createContinuitySnapshotChallenge(ownerAddress: string): string {
  const checksum = toChecksumAddress(ownerAddress)
  return [
    'ethagent private continuity',
    `Owner: ${checksum}`,
    'Purpose: unlock the encrypted SOUL.md and MEMORY.md snapshot for this device',
    'Scope: read and restore private agent continuity only',
    'Safety: this signature does not send a transaction, spend funds, or grant token approval',
    'Version: 1',
  ].join('\n')
}

export function createContinuitySnapshotEnvelope(args: CreateContinuitySnapshotEnvelopeArgs): ContinuitySnapshotEnvelope {
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const challenge = createContinuitySnapshotChallenge(ownerAddress)
  assertSignatureForAddress(challenge, args.walletSignature, ownerAddress)

  const createdAt = args.payload.createdAt ?? new Date().toISOString()
  const payload: ContinuitySnapshotPayload = {
    version: 1,
    ownerAddress,
    createdAt,
    ...(args.payload.sequence !== undefined ? { sequence: args.payload.sequence } : {}),
    agent: normalizeAgentSnapshot(args.payload.agent),
    files: normalizeContinuityFiles(args.payload.files),
    transcript: normalizeTranscript(args.payload.transcript),
    state: normalizeState(args.payload.state),
  }

  const salt = crypto.randomBytes(32)
  const kemSeed = deriveContinuityKemSeed(args.walletSignature, salt, ownerAddress)
  const kemKeys = ml_kem1024.keygen(kemSeed)
  const kem = ml_kem1024.encapsulate(kemKeys.publicKey)
  const key = deriveContinuityAesKey(args.walletSignature, kem.sharedSecret, salt, ownerAddress)
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(continuityAadFor(ownerAddress, createdAt))
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
    ownerAddress,
    createdAt,
    challenge,
    crypto: {
      kem: 'ML-KEM-1024',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      signature: 'EIP-191',
    },
    salt: toBase64(salt),
    kemPublicKey: toBase64(kemKeys.publicKey),
    kemCiphertext: toBase64(kem.cipherText),
    nonce: toBase64(nonce),
    ciphertext: toBase64(encrypted),
    tag: toBase64(tag),
  }
}

export function restoreContinuitySnapshotEnvelope(args: RestoreContinuitySnapshotEnvelopeArgs): ContinuitySnapshotPayload {
  const envelope = normalizeContinuitySnapshotEnvelope(args.envelope)
  assertSignatureForAddress(envelope.challenge, args.walletSignature, envelope.ownerAddress)

  const salt = fromBase64(envelope.salt)
  const kemSeed = deriveContinuityKemSeed(args.walletSignature, salt, envelope.ownerAddress)
  const kemKeys = ml_kem1024.keygen(kemSeed)
  const expectedPublicKey = toBase64(kemKeys.publicKey)
  if (expectedPublicKey !== envelope.kemPublicKey) {
    throw new Error('wallet signature does not match this continuity snapshot')
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
    throw new Error('could not decrypt continuity snapshot with the supplied wallet signature')
  }

  const payload = normalizeContinuityPayload(decoded)
  if (payload.ownerAddress.toLowerCase() !== envelope.ownerAddress.toLowerCase()) {
    throw new Error('continuity snapshot owner mismatch')
  }
  if (payload.createdAt !== envelope.createdAt) {
    throw new Error('continuity snapshot timestamp mismatch')
  }
  return payload
}

export function assertContinuitySnapshotOwner(envelope: ContinuitySnapshotEnvelope, currentOwner: string): void {
  const snapshotOwner = toChecksumAddress(envelope.ownerAddress)
  const owner = toChecksumAddress(currentOwner)
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

function normalizeContinuitySnapshotEnvelope(input: unknown): ContinuitySnapshotEnvelope {
  if (!isContinuitySnapshotEnvelope(input)) throw new Error('invalid continuity snapshot envelope')
  if (input.envelopeVersion !== CONTINUITY_SNAPSHOT_ENVELOPE_VERSION) {
    throw new Error('unsupported continuity snapshot envelope version')
  }
  if (input.crypto.kem !== 'ML-KEM-1024' || input.crypto.aead !== 'AES-256-GCM') {
    throw new Error('unsupported continuity snapshot crypto suite')
  }
  return {
    ...input,
    ownerAddress: toChecksumAddress(input.ownerAddress),
  }
}

function isContinuitySnapshotEnvelope(input: unknown): input is ContinuitySnapshotEnvelope {
  if (!input || typeof input !== 'object') return false
  const obj = input as Partial<ContinuitySnapshotEnvelope> & { walletSignature?: unknown }
  return obj.version === 1
    && obj.envelopeVersion === CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
    && typeof obj.ownerAddress === 'string'
    && typeof obj.createdAt === 'string'
    && typeof obj.challenge === 'string'
    && obj.walletSignature === undefined
    && typeof obj.salt === 'string'
    && typeof obj.kemPublicKey === 'string'
    && typeof obj.kemCiphertext === 'string'
    && typeof obj.nonce === 'string'
    && typeof obj.ciphertext === 'string'
    && typeof obj.tag === 'string'
    && !!obj.crypto
}

function normalizeContinuityPayload(input: unknown): ContinuitySnapshotPayload {
  if (!input || typeof input !== 'object') throw new Error('continuity snapshot payload is invalid')
  const obj = input as Partial<ContinuitySnapshotPayload>
  if (obj.version !== 1) throw new Error('continuity snapshot payload version is invalid')
  if (typeof obj.ownerAddress !== 'string') throw new Error('continuity snapshot owner is invalid')
  if (typeof obj.createdAt !== 'string') throw new Error('continuity snapshot timestamp is invalid')
  return {
    version: 1,
    ownerAddress: toChecksumAddress(obj.ownerAddress),
    createdAt: obj.createdAt,
    ...(typeof obj.sequence === 'number' && Number.isSafeInteger(obj.sequence) ? { sequence: obj.sequence } : {}),
    agent: normalizeAgentSnapshot(obj.agent),
    files: normalizeContinuityFiles(obj.files),
    transcript: normalizeTranscript(obj.transcript),
    state: normalizeState(obj.state),
  }
}

function normalizeAgentSnapshot(input: unknown): ContinuityAgentSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const obj = input as Record<string, unknown>
  return {
    ...(typeof obj.chainId === 'number' && Number.isSafeInteger(obj.chainId) && obj.chainId > 0 ? { chainId: obj.chainId } : {}),
    ...(typeof obj.identityRegistryAddress === 'string' ? { identityRegistryAddress: obj.identityRegistryAddress } : {}),
    ...(typeof obj.agentId === 'string' ? { agentId: obj.agentId } : {}),
    ...(typeof obj.agentUri === 'string' ? { agentUri: obj.agentUri } : {}),
    ...(typeof obj.metadataCid === 'string' ? { metadataCid: obj.metadataCid } : {}),
    ...(typeof obj.name === 'string' ? { name: obj.name } : {}),
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
  }
}

function normalizeContinuityFiles(input: unknown): ContinuityFiles {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('continuity snapshot files are invalid')
  }
  const obj = input as Partial<ContinuityFiles>
  if (typeof obj['SOUL.md'] !== 'string') throw new Error('SOUL.md is missing from continuity snapshot')
  if (typeof obj['MEMORY.md'] !== 'string') throw new Error('MEMORY.md is missing from continuity snapshot')
  return {
    'SOUL.md': obj['SOUL.md'],
    'MEMORY.md': obj['MEMORY.md'],
  }
}

function normalizeTranscript(input: unknown): ContinuityTranscriptSummary[] {
  if (!Array.isArray(input)) return []
  return input.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const obj = item as Partial<ContinuityTranscriptSummary>
    if (typeof obj.summary !== 'string' || !obj.summary.trim()) return []
    return [{
      ...(typeof obj.sessionId === 'string' ? { sessionId: obj.sessionId } : {}),
      ...(typeof obj.createdAt === 'string' ? { createdAt: obj.createdAt } : {}),
      summary: obj.summary,
    }]
  })
}

function normalizeState(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function assertSignatureForAddress(challenge: string, signature: string, address: string): void {
  const recovered = recoverAddressFromSignature(challenge, signature)
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('wallet signature does not match continuity snapshot owner')
  }
}

function deriveContinuityKemSeed(walletSignature: string, salt: Uint8Array, ownerAddress: string): Uint8Array {
  return hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:ml-kem1024:${ownerAddress.toLowerCase()}`,
    64,
  )
}

function deriveContinuityAesKey(
  walletSignature: string,
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  ownerAddress: string,
): Buffer {
  return Buffer.from(hkdf(
    Buffer.concat([
      Buffer.from(walletSignature, 'utf8'),
      Buffer.from('\n', 'utf8'),
      Buffer.from(sharedSecret),
    ]),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:aes-256-gcm:${ownerAddress.toLowerCase()}`,
    32,
  ))
}

function continuityAadFor(ownerAddress: string, createdAt: string): Buffer {
  return Buffer.from(`${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}\n${ownerAddress.toLowerCase()}\n${createdAt}`, 'utf8')
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), length))
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
