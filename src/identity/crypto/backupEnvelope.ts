import crypto from 'node:crypto'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { recoverAddressFromSignature, toChecksumAddress } from './eth.js'

export const AGENT_STATE_BACKUP_ENVELOPE_VERSION = 'ethagent-state-backup-v1'

type AgentStatePayload = {
  ownerAddress: string
  createdAt: string
  state: Record<string, unknown>
}

export type AgentStateBackupEnvelope = {
  version: 1
  envelopeVersion: typeof AGENT_STATE_BACKUP_ENVELOPE_VERSION
  ownerAddress: string
  createdAt: string
  challenge: string
  crypto: {
    kem: 'ML-KEM-768'
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

type CreateAgentStateBackupArgs = {
  ownerAddress: string
  walletSignature: string
  state: Record<string, unknown>
  createdAt?: string
}

type RestoreAgentStateBackupArgs = {
  envelope: AgentStateBackupEnvelope
  walletSignature: string
}

export class AgentStateOwnerMismatchError extends Error {
  constructor(
    readonly backupOwner: string,
    readonly currentOwner: string,
  ) {
    super('Agent backup is encrypted for another wallet')
    this.name = 'AgentStateOwnerMismatchError'
  }
}

export function createAgentStateRecoveryChallenge(ownerAddress: string): string {
  const checksum = toChecksumAddress(ownerAddress)
  return [
    'Encrypted State Access',
    `Owner: ${checksum}`,
    'Action: authorize this wallet to unlock the encrypted agent backup',
    'Version: 1',
  ].join('\n')
}

export function createAgentStateBackupEnvelope(args: CreateAgentStateBackupArgs): AgentStateBackupEnvelope {
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const challenge = createAgentStateRecoveryChallenge(ownerAddress)
  assertSignatureForAddress(challenge, args.walletSignature, ownerAddress)

  const createdAt = args.createdAt ?? new Date().toISOString()
  const salt = crypto.randomBytes(32)
  const kemSeed = deriveStateKemSeed(args.walletSignature, salt, ownerAddress)
  const kemKeys = ml_kem768.keygen(kemSeed)
  const kem = ml_kem768.encapsulate(kemKeys.publicKey)
  const key = deriveStateAesKey(args.walletSignature, kem.sharedSecret, salt, ownerAddress)
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(stateAadFor(ownerAddress, createdAt))
  const plaintext = Buffer.from(JSON.stringify({
    ownerAddress,
    createdAt,
    state: args.state,
  } satisfies AgentStatePayload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    envelopeVersion: AGENT_STATE_BACKUP_ENVELOPE_VERSION,
    ownerAddress,
    createdAt,
    challenge,
    crypto: {
      kem: 'ML-KEM-768',
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

export function restoreAgentStateBackupEnvelope(args: RestoreAgentStateBackupArgs): AgentStatePayload {
  const envelope = normalizeAgentStateEnvelope(args.envelope)
  assertSignatureForAddress(envelope.challenge, args.walletSignature, envelope.ownerAddress)

  const salt = fromBase64(envelope.salt)
  const kemSeed = deriveStateKemSeed(args.walletSignature, salt, envelope.ownerAddress)
  const kemKeys = ml_kem768.keygen(kemSeed)
  const expectedPublicKey = toBase64(kemKeys.publicKey)
  if (expectedPublicKey !== envelope.kemPublicKey) {
    throw new Error('Wallet signature does not match this agent backup')
  }

  const sharedSecret = ml_kem768.decapsulate(fromBase64(envelope.kemCiphertext), kemKeys.secretKey)
  const key = deriveStateAesKey(args.walletSignature, sharedSecret, salt, envelope.ownerAddress)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromBase64(envelope.nonce))
  decipher.setAAD(stateAadFor(envelope.ownerAddress, envelope.createdAt))
  decipher.setAuthTag(fromBase64(envelope.tag))

  let decoded: unknown
  try {
    const plaintext = Buffer.concat([
      decipher.update(fromBase64(envelope.ciphertext)),
      decipher.final(),
    ]).toString('utf8')
    decoded = JSON.parse(plaintext)
  } catch {
    throw new Error('Could not decrypt agent state with the supplied wallet signature')
  }

  if (!isAgentStatePayload(decoded)) throw new Error('Agent state backup payload is invalid')
  if (decoded.ownerAddress.toLowerCase() !== envelope.ownerAddress.toLowerCase()) {
    throw new Error('Agent state backup owner mismatch')
  }
  return {
    ...decoded,
    ownerAddress: toChecksumAddress(decoded.ownerAddress),
  }
}

export function assertAgentStateBackupOwner(envelope: AgentStateBackupEnvelope, currentOwner: string): void {
  const backupOwner = toChecksumAddress(envelope.ownerAddress)
  const owner = toChecksumAddress(currentOwner)
  if (backupOwner.toLowerCase() !== owner.toLowerCase()) {
    throw new AgentStateOwnerMismatchError(backupOwner, owner)
  }
}

export function serializeAgentStateBackupEnvelope(envelope: AgentStateBackupEnvelope): string {
  return JSON.stringify(normalizeAgentStateEnvelope(envelope), null, 2)
}

export function parseAgentStateBackupEnvelope(raw: string | Uint8Array): AgentStateBackupEnvelope {
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
  const parsed = JSON.parse(text) as unknown
  return normalizeAgentStateEnvelope(parsed)
}

function normalizeAgentStateEnvelope(input: unknown): AgentStateBackupEnvelope {
  if (!isAgentStateEnvelope(input)) throw new Error('Invalid agent state backup envelope')
  if (input.envelopeVersion !== AGENT_STATE_BACKUP_ENVELOPE_VERSION) throw new Error('Unsupported agent state backup envelope version')
  if (input.crypto.kem !== 'ML-KEM-768' || input.crypto.aead !== 'AES-256-GCM') {
    throw new Error('Unsupported backup crypto suite')
  }
  return {
    ...input,
    ownerAddress: toChecksumAddress(input.ownerAddress),
  }
}

function isAgentStateEnvelope(input: unknown): input is AgentStateBackupEnvelope {
  if (!input || typeof input !== 'object') return false
  const obj = input as Partial<AgentStateBackupEnvelope> & { walletSignature?: unknown }
  return obj.version === 1
    && obj.envelopeVersion === AGENT_STATE_BACKUP_ENVELOPE_VERSION
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

function isAgentStatePayload(input: unknown): input is AgentStatePayload {
  if (!input || typeof input !== 'object') return false
  const obj = input as Partial<AgentStatePayload>
  return typeof obj.ownerAddress === 'string'
    && typeof obj.createdAt === 'string'
    && !!obj.state
    && typeof obj.state === 'object'
    && !Array.isArray(obj.state)
}

function assertSignatureForAddress(challenge: string, signature: string, address: string): void {
  const recovered = recoverAddressFromSignature(challenge, signature)
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Wallet signature does not match backup address')
  }
}

function deriveStateKemSeed(walletSignature: string, salt: Uint8Array, ownerAddress: string): Uint8Array {
  return hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${AGENT_STATE_BACKUP_ENVELOPE_VERSION}:ml-kem768:${ownerAddress.toLowerCase()}`,
    64,
  )
}

function deriveStateAesKey(
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
    `ethagent:${AGENT_STATE_BACKUP_ENVELOPE_VERSION}:aes-256-gcm:${ownerAddress.toLowerCase()}`,
    32,
  ))
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), length))
}

function stateAadFor(ownerAddress: string, createdAt: string): Buffer {
  return Buffer.from(`${AGENT_STATE_BACKUP_ENVELOPE_VERSION}\n${ownerAddress.toLowerCase()}\n${createdAt}`, 'utf8')
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
