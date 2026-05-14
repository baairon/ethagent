import crypto from 'node:crypto'
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js'
import { recoverAddressFromSignature, toChecksumAddress } from '../crypto/eth.js'
import type { TransferSnapshotMetadata } from '../../storage/config.js'

export const CONTINUITY_SNAPSHOT_ENVELOPE_VERSION = 'ethagent-continuity-snapshot-v1'

export type ContinuityFiles = {
  'SOUL.md': string
  'MEMORY.md': string
}

export type ContinuitySkillsTree = Record<string, string>

const PRIVATE_SKILL_FILE_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/
const PRIVATE_SKILL_LAST_SEG_FILE_RE = /^[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/
const LEGACY_NESTED_SKILL_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/.+$/
const LEGACY_FLAT_NAME_MD_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.md$/i
const MAX_PRIVATE_SKILL_ENTRIES = 500
const MAX_PRIVATE_SKILL_BODY_BYTES = 256 * 1024
const MAX_PRIVATE_SKILL_PATH_LEN = 256

type ContinuityTranscriptSummary = {
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

type ContinuitySnapshotPayload = {
  version: 1
  ownerAddress: string
  createdAt: string
  sequence?: number
  agent: ContinuityAgentSnapshot
  files: ContinuityFiles
  skills?: ContinuitySkillsTree
  transcript: ContinuityTranscriptSummary[]
  state: Record<string, unknown>
}

type ContinuitySnapshotToken = {
  chainId: number
  identityRegistryAddress: string
  agentId: string
}

type TransferContinuitySnapshotSlot = {
  address: string
  challenge: string
  salt: string
  nonce: string
  encryptedKey: string
  tag: string
}

export type WalletContinuityRestoreAccessKey = {
  address: string
  challenge: string
  salt: string
  kemPublicKey: string
  createdAt?: string
}

type WalletContinuitySnapshotSlot = {
  address: string
  challenge: string
  salt: string
  kemPublicKey: string
  kemCiphertext: string
  nonce: string
  encryptedKey: string
  tag: string
}

type SignatureContinuitySnapshotEnvelope = {
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
    decryptsWith?: 'owner-signature'
  }
  salt: string
  kemPublicKey: string
  kemCiphertext: string
  nonce: string
  ciphertext: string
  tag: string
}

type WalletContinuitySnapshotEnvelope = {
  version: 1
  envelopeVersion: typeof CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
  ownerAddress: string
  createdAt: string
  token: ContinuitySnapshotToken
  accessEpoch: number
  accessManifestHash: string
  crypto: {
    kem: 'ML-KEM-1024'
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    signature: 'EIP-191'
    decryptsWith: 'wallet-signature-slots'
  }
  payloadNonce: string
  payloadCiphertext: string
  payloadTag: string
  payloadHash: string
  slots: WalletContinuitySnapshotSlot[]
}

export type TransferContinuitySnapshotEnvelope = {
  version: 1
  envelopeVersion: typeof CONTINUITY_SNAPSHOT_ENVELOPE_VERSION
  ownerAddress: string
  createdAt: string
  challenge: string
  token: ContinuitySnapshotToken
  targetAddress: string
  targetHandle?: string
  crypto: {
    aead: 'AES-256-GCM'
    kdf: 'HKDF-SHA256'
    signature: 'EIP-191'
    decryptsWith: 'transfer-signature-slot'
  }
  payloadNonce: string
  payloadCiphertext: string
  payloadTag: string
  payloadHash: string
  slots: {
    owner: TransferContinuitySnapshotSlot
    target: TransferContinuitySnapshotSlot
  }
}

export type ContinuitySnapshotEnvelope =
  | SignatureContinuitySnapshotEnvelope
  | WalletContinuitySnapshotEnvelope
  | TransferContinuitySnapshotEnvelope

type CreateContinuitySnapshotEnvelopeArgs = {
  ownerAddress: string
  walletSignature: string
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & {
    createdAt?: string
  }
}

type CreateTransferContinuitySnapshotEnvelopeArgs = {
  ownerAddress: string
  ownerWalletSignature: string
  targetAddress: string
  targetWalletSignature: string
  targetHandle?: string
  token: ContinuitySnapshotToken
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & {
    createdAt?: string
  }
}

type CreateWalletContinuitySnapshotEnvelopeArgs = {
  ownerAddress: string
  token: ContinuitySnapshotToken
  signerAddress: string
  signerWalletSignature: string
  accessKeys: WalletContinuityRestoreAccessKey[]
  accessEpoch?: number
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & {
    createdAt?: string
  }
}

type RestoreContinuitySnapshotEnvelopeArgs = {
  envelope: ContinuitySnapshotEnvelope
  walletSignature: string
  currentOwnerAddress?: string
}

export class ContinuitySnapshotOwnerMismatchError extends Error {
  constructor(
    readonly snapshotOwner: string,
    readonly currentOwner: string,
  ) {
    super('Continuity snapshot is encrypted for another wallet')
    this.name = 'ContinuitySnapshotOwnerMismatchError'
  }
}

export class ContinuityTransferSnapshotTargetMismatchError extends Error {
  constructor(
    readonly snapshotOwner: string,
    readonly targetOwner: string,
    readonly currentOwner: string,
  ) {
    super('Transfer snapshot receiver does not match the current token owner')
    this.name = 'ContinuityTransferSnapshotTargetMismatchError'
  }
}

export class ContinuitySnapshotRestoreSlotMissingError extends Error {
  constructor(readonly walletAddress: string) {
    super('Restore slot missing')
    this.name = 'ContinuitySnapshotRestoreSlotMissingError'
  }
}

const CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES = [
  'Save or Restore Identity Files',
  'Action: encrypt or decrypt local identity files',
  'Private: SOUL.md, MEMORY.md, skills',
  'Public: public skills and profile',
  'Safety: no transaction, spending, or approvals',
  'Version: 2',
] as const

export function createContinuitySnapshotChallenge(ownerAddress: string): string {
  const checksum = toChecksumAddress(ownerAddress)
  return [
    CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES[0],
    `Owner: ${checksum}`,
    ...CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES.slice(1),
  ].join('\n')
}

export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_LEGACY = 'Prepare Transfer Restore Snapshot'
export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_SENDER = 'Prepare Transfer Snapshot · Sender Restore Slot'
export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_RECEIVER = 'Prepare Transfer Snapshot · Receiver Restore Slot'

export function createTransferContinuitySnapshotChallenge(args: {
  token: ContinuitySnapshotToken
  ownerAddress: string
  targetAddress: string
  role?: 'sender' | 'receiver'
}): string {
  const token = normalizeContinuitySnapshotToken(args.token)
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const targetAddress = toChecksumAddress(args.targetAddress)
  const header = args.role === 'sender'
    ? TRANSFER_SNAPSHOT_CHALLENGE_HEADER_SENDER
    : args.role === 'receiver'
      ? TRANSFER_SNAPSHOT_CHALLENGE_HEADER_RECEIVER
      : TRANSFER_SNAPSHOT_CHALLENGE_HEADER_LEGACY
  return [
    header,
    `ERC-8004 Chain ID: ${token.chainId}`,
    `ERC-8004 Registry: ${token.identityRegistryAddress}`,
    `ERC-8004 Token ID: ${token.agentId}`,
    `Sender Owner: ${ownerAddress}`,
    `Receiver Owner: ${targetAddress}`,
    'Action: encrypt or decrypt local identity files for this token transfer',
    'Private: SOUL.md, MEMORY.md, skills',
    'Public: public skills and profile',
    'Safety: no transaction, spending, or approvals',
    'Version: 2',
  ].join('\n')
}

export type WalletChallengePurpose =
  | 'create-agent'
  | 'update-snapshot'
  | 'update-ens-snapshot'
  | 'clear-ens-snapshot'
  | 'update-profile-snapshot'
  | 'update-operators-snapshot'
  | 'refetch-snapshot'
  | 'operator-proof'
  | 'restore-owner'
  | 'restore-operator'
  | 'transfer-prepare-sender'
  | 'transfer-prepare-receiver'

const WALLET_CHALLENGE_V2_COPY: Record<WalletChallengePurpose, { title: string; action: string }> = {
  'create-agent':              { title: 'Create Agent Snapshot Key',                action: 'Action: encrypt the new agent snapshot for owner restore' },
  'update-snapshot':           { title: 'Save Snapshot Encryption Key',              action: 'Action: encrypt the updated agent snapshot' },
  'update-ens-snapshot':       { title: 'Update ENS in Agent Snapshot',              action: 'Action: encrypt the snapshot with the new ENS name. No onchain ENS records change.' },
  'clear-ens-snapshot':        { title: 'Unlink ENS from Agent',                     action: 'Action: encrypt the snapshot with no ENS name. No onchain ENS records change.' },
  'update-profile-snapshot':   { title: 'Update Public Profile Snapshot Key',        action: 'Action: encrypt the snapshot with the updated profile' },
  'update-operators-snapshot': { title: 'Update Operator Wallets Snapshot Key',      action: 'Action: encrypt the snapshot with the updated operator list' },
  'refetch-snapshot':          { title: 'Refetch Latest Snapshot',                   action: 'Action: decrypt the latest published snapshot' },
  'operator-proof':            { title: 'Authorize Operator Wallet Restore Access',  action: 'Action: prove this operator wallet can decrypt future snapshots' },
  'restore-owner':             { title: 'Restore Agent with Owner Wallet',           action: 'Action: decrypt the snapshot for the owner wallet' },
  'restore-operator':          { title: 'Restore Agent with Operator Wallet',        action: 'Action: decrypt the snapshot for the authorized operator wallet' },
  'transfer-prepare-sender':   { title: 'Prepare Token Transfer (Sender)',           action: 'Action: encrypt the transfer snapshot for the receiver' },
  'transfer-prepare-receiver': { title: 'Receive Token Transfer (Receiver)',         action: 'Action: prepare receiver decryption for the transfer snapshot' },
}

export function createWalletRestoreAccessChallenge(args: {
  token: ContinuitySnapshotToken
  ownerAddress: string
  walletAddress: string
  accessEpoch?: number
  purpose?: WalletChallengePurpose
}): string {
  const token = normalizeContinuitySnapshotToken(args.token)
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const walletAddress = toChecksumAddress(args.walletAddress)
  if (args.purpose) {
    const copy = WALLET_CHALLENGE_V2_COPY[args.purpose]
    return [
      copy.title,
      `ERC-8004 Chain ID: ${token.chainId}`,
      `ERC-8004 Registry: ${token.identityRegistryAddress}`,
      `ERC-8004 Token ID: ${token.agentId}`,
      `Owner: ${ownerAddress}`,
      `Wallet: ${walletAddress}`,
      `Access Epoch: ${args.accessEpoch ?? 1}`,
      copy.action,
      'Private: SOUL.md, MEMORY.md, skills',
      'Safety: no transaction, spending, or approvals',
      'Version: 3',
    ].join('\n')
  }
  return [
    'Authorize Wallet Restore Access',
    `ERC-8004 Chain ID: ${token.chainId}`,
    `ERC-8004 Registry: ${token.identityRegistryAddress}`,
    `ERC-8004 Token ID: ${token.agentId}`,
    `Owner: ${ownerAddress}`,
    `Wallet: ${walletAddress}`,
    `Access Epoch: ${args.accessEpoch ?? 1}`,
    'Action: create a restore key for encrypted identity snapshots',
    'Private: SOUL.md, MEMORY.md, skills',
    'Safety: no transaction, spending, or approvals',
    'Version: 2',
  ].join('\n')
}

export function createWalletRestoreAccessKey(args: {
  token: ContinuitySnapshotToken
  ownerAddress: string
  walletAddress: string
  walletSignature: string
  accessEpoch?: number
  createdAt?: string
  salt?: string
  purpose?: WalletChallengePurpose
}): WalletContinuityRestoreAccessKey {
  const walletAddress = toChecksumAddress(args.walletAddress)
  const challenge = createWalletRestoreAccessChallenge({
    token: args.token,
    ownerAddress: args.ownerAddress,
    walletAddress,
    accessEpoch: args.accessEpoch,
    purpose: args.purpose,
  })
  assertSignatureForAddress(challenge, args.walletSignature, walletAddress)
  const salt = args.salt ? fromBase64(args.salt) : crypto.randomBytes(32)
  const kemSeed = deriveWalletRestoreKemSeed(args.walletSignature, salt, walletAddress, challenge)
  const kemKeys = ml_kem1024.keygen(kemSeed)
  return {
    address: walletAddress,
    challenge,
    salt: toBase64(salt),
    kemPublicKey: toBase64(kemKeys.publicKey),
    ...(args.createdAt ? { createdAt: args.createdAt } : {}),
  }
}

export function createContinuitySnapshotEnvelope(args: CreateContinuitySnapshotEnvelopeArgs): SignatureContinuitySnapshotEnvelope {
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const challenge = createContinuitySnapshotChallenge(ownerAddress)
  assertSignatureForAddress(challenge, args.walletSignature, ownerAddress)

  const createdAt = args.payload.createdAt ?? new Date().toISOString()
  const payload = continuityPayloadFromArgs({
    ownerAddress,
    createdAt,
    payload: args.payload,
  })

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
      decryptsWith: 'owner-signature',
    },
    salt: toBase64(salt),
    kemPublicKey: toBase64(kemKeys.publicKey),
    kemCiphertext: toBase64(kem.cipherText),
    nonce: toBase64(nonce),
    ciphertext: toBase64(encrypted),
    tag: toBase64(tag),
  }
}

export function createWalletContinuitySnapshotEnvelope(
  args: CreateWalletContinuitySnapshotEnvelopeArgs,
): WalletContinuitySnapshotEnvelope {
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const signerAddress = toChecksumAddress(args.signerAddress)
  const token = normalizeContinuitySnapshotToken(args.token)
  const accessEpoch = args.accessEpoch ?? 1
  const accessKeys = normalizeWalletRestoreAccessKeys(args.accessKeys)
  if (accessKeys.length === 0) throw new Error('At least one restore access key is required')
  const signerKey = accessKeys.find(key => key.address.toLowerCase() === signerAddress.toLowerCase())
  if (!signerKey) throw new Error('Snapshot signer is not an authorized restore wallet')
  assertSignatureForAddress(signerKey.challenge, args.signerWalletSignature, signerAddress)

  const createdAt = args.payload.createdAt ?? new Date().toISOString()
  const payload = continuityPayloadFromArgs({
    ownerAddress,
    createdAt,
    payload: {
      ...args.payload,
      agent: normalizeAgentSnapshot({
        ...args.payload.agent,
        chainId: args.payload.agent.chainId ?? token.chainId,
        identityRegistryAddress: args.payload.agent.identityRegistryAddress ?? token.identityRegistryAddress,
        agentId: args.payload.agent.agentId ?? token.agentId,
      }),
    },
  })
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const contentKey = crypto.randomBytes(32)
  const payloadNonce = crypto.randomBytes(12)
  const accessManifestHash = walletAccessManifestHash({ ownerAddress, token, accessEpoch, accessKeys })
  const payloadAad = walletPayloadAadFor({ ownerAddress, createdAt, token, accessEpoch, accessManifestHash })
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, payloadNonce)
  cipher.setAAD(payloadAad)
  const payloadCiphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const payloadTag = cipher.getAuthTag()

  return {
    version: 1,
    envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
    ownerAddress,
    createdAt,
    token,
    accessEpoch,
    accessManifestHash,
    crypto: {
      kem: 'ML-KEM-1024',
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      signature: 'EIP-191',
      decryptsWith: 'wallet-signature-slots',
    },
    payloadNonce: toBase64(payloadNonce),
    payloadCiphertext: toBase64(payloadCiphertext),
    payloadTag: toBase64(payloadTag),
    payloadHash: sha256Hex(plaintext),
    slots: accessKeys.map(key => createWalletSlot({ accessKey: key, contentKey, payloadAad, accessManifestHash })),
  }
}

export function createTransferContinuitySnapshotEnvelope(
  args: CreateTransferContinuitySnapshotEnvelopeArgs,
): TransferContinuitySnapshotEnvelope {
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const targetAddress = toChecksumAddress(args.targetAddress)
  if (ownerAddress.toLowerCase() === targetAddress.toLowerCase()) {
    throw new Error('Receiver wallet must be different from sender wallet')
  }
  const token = normalizeContinuitySnapshotToken(args.token)
  const senderChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'sender' })
  const receiverChallenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress, role: 'receiver' })
  const challenge = createTransferContinuitySnapshotChallenge({ token, ownerAddress, targetAddress })
  assertSignatureForAddress(senderChallenge, args.ownerWalletSignature, ownerAddress)
  assertSignatureForAddress(receiverChallenge, args.targetWalletSignature, targetAddress)

  const createdAt = args.payload.createdAt ?? new Date().toISOString()
  const payload = continuityPayloadFromArgs({
    ownerAddress,
    createdAt,
    payload: {
      ...args.payload,
      agent: normalizeAgentSnapshot({
        ...args.payload.agent,
        chainId: args.payload.agent.chainId ?? token.chainId,
        identityRegistryAddress: args.payload.agent.identityRegistryAddress ?? token.identityRegistryAddress,
        agentId: args.payload.agent.agentId ?? token.agentId,
      }),
    },
  })
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const contentKey = crypto.randomBytes(32)
  const payloadNonce = crypto.randomBytes(12)
  const payloadAad = transferPayloadAadFor({ ownerAddress, targetAddress, createdAt, token })
  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, payloadNonce)
  cipher.setAAD(payloadAad)
  const payloadCiphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const payloadTag = cipher.getAuthTag()

  const ownerSlot = createTransferSlot({
    address: ownerAddress,
    challenge: senderChallenge,
    walletSignature: args.ownerWalletSignature,
    contentKey,
    payloadAad,
  })
  const targetSlot = createTransferSlot({
    address: targetAddress,
    challenge: receiverChallenge,
    walletSignature: args.targetWalletSignature,
    contentKey,
    payloadAad,
  })

  return {
    version: 1,
    envelopeVersion: CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
    ownerAddress,
    createdAt,
    challenge,
    token,
    targetAddress,
    ...(args.targetHandle ? { targetHandle: args.targetHandle } : {}),
    crypto: {
      aead: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      signature: 'EIP-191',
      decryptsWith: 'transfer-signature-slot',
    },
    payloadNonce: toBase64(payloadNonce),
    payloadCiphertext: toBase64(payloadCiphertext),
    payloadTag: toBase64(payloadTag),
    payloadHash: sha256Hex(plaintext),
    slots: {
      owner: ownerSlot,
      target: targetSlot,
    },
  }
}

export function restoreContinuitySnapshotEnvelope(args: RestoreContinuitySnapshotEnvelopeArgs): ContinuitySnapshotPayload {
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

function isTransferContinuitySnapshotEnvelope(input: unknown): input is TransferContinuitySnapshotEnvelope {
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
    : toChecksumAddress(recoverAddressFromSignature(args.envelope.challenge, args.walletSignature))
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

function transferSlotForCurrentOwner(
  envelope: TransferContinuitySnapshotEnvelope,
  currentOwner: string,
): TransferContinuitySnapshotSlot {
  if (currentOwner.toLowerCase() === envelope.ownerAddress.toLowerCase()) return envelope.slots.owner
  if (currentOwner.toLowerCase() === envelope.targetAddress.toLowerCase()) return envelope.slots.target
  throw new ContinuityTransferSnapshotTargetMismatchError(envelope.ownerAddress, envelope.targetAddress, currentOwner)
}

function createTransferSlot(args: {
  address: string
  challenge: string
  walletSignature: string
  contentKey: Uint8Array
  payloadAad: Buffer
}): TransferContinuitySnapshotSlot {
  const address = toChecksumAddress(args.address)
  const salt = crypto.randomBytes(32)
  const nonce = crypto.randomBytes(12)
  const slotKey = deriveTransferSlotKey(args.walletSignature, salt, address, args.challenge)
  const cipher = crypto.createCipheriv('aes-256-gcm', slotKey, nonce)
  const slot: TransferContinuitySnapshotSlot = {
    address,
    challenge: args.challenge,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    encryptedKey: '',
    tag: '',
  }
  cipher.setAAD(transferSlotAadFor(slot, args.payloadAad))
  const encryptedKey = Buffer.concat([cipher.update(args.contentKey), cipher.final()])
  return {
    ...slot,
    encryptedKey: toBase64(encryptedKey),
    tag: toBase64(cipher.getAuthTag()),
  }
}

function createWalletSlot(args: {
  accessKey: WalletContinuityRestoreAccessKey
  contentKey: Uint8Array
  payloadAad: Buffer
  accessManifestHash: string
}): WalletContinuitySnapshotSlot {
  const accessKey = normalizeWalletRestoreAccessKey(args.accessKey)
  const publicKey = fromBase64(accessKey.kemPublicKey)
  const kem = ml_kem1024.encapsulate(publicKey)
  const salt = fromBase64(accessKey.salt)
  const nonce = crypto.randomBytes(12)
  const slotKey = deriveWalletSlotAesKey(kem.sharedSecret, salt, accessKey.address, accessKey.challenge, args.accessManifestHash)
  const cipher = crypto.createCipheriv('aes-256-gcm', slotKey, nonce)
  const slot: WalletContinuitySnapshotSlot = {
    address: accessKey.address,
    challenge: accessKey.challenge,
    salt: accessKey.salt,
    kemPublicKey: accessKey.kemPublicKey,
    kemCiphertext: toBase64(kem.cipherText),
    nonce: toBase64(nonce),
    encryptedKey: '',
    tag: '',
  }
  cipher.setAAD(walletSlotAadFor(slot, args.payloadAad))
  const encryptedKey = Buffer.concat([cipher.update(args.contentKey), cipher.final()])
  return {
    ...slot,
    encryptedKey: toBase64(encryptedKey),
    tag: toBase64(cipher.getAuthTag()),
  }
}

function normalizeContinuitySnapshotEnvelope(input: unknown): ContinuitySnapshotEnvelope {
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

function continuityPayloadFromArgs(args: {
  ownerAddress: string
  createdAt: string
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & { createdAt?: string }
}): ContinuitySnapshotPayload {
  const skills = normalizeContinuitySkills(args.payload.skills)
  return {
    version: 1,
    ownerAddress: args.ownerAddress,
    createdAt: args.createdAt,
    ...(args.payload.sequence !== undefined ? { sequence: args.payload.sequence } : {}),
    agent: normalizeAgentSnapshot(args.payload.agent),
    files: normalizeContinuityFiles(args.payload.files),
    ...(skills ? { skills } : {}),
    transcript: normalizeTranscript(args.payload.transcript),
    state: normalizeState(args.payload.state),
  }
}

function normalizeContinuityPayload(input: unknown): ContinuitySnapshotPayload {
  if (!input || typeof input !== 'object') throw new Error('Continuity snapshot payload is invalid')
  const obj = input as Partial<ContinuitySnapshotPayload>
  if (obj.version !== 1) throw new Error('Continuity snapshot payload version is invalid')
  if (typeof obj.ownerAddress !== 'string') throw new Error('Continuity snapshot owner is invalid')
  if (typeof obj.createdAt !== 'string') throw new Error('Continuity snapshot timestamp is invalid')
  const skills = normalizeContinuitySkills(obj.skills)
  return {
    version: 1,
    ownerAddress: toChecksumAddress(obj.ownerAddress),
    createdAt: obj.createdAt,
    ...(typeof obj.sequence === 'number' && Number.isSafeInteger(obj.sequence) ? { sequence: obj.sequence } : {}),
    agent: normalizeAgentSnapshot(obj.agent),
    files: normalizeContinuityFiles(obj.files),
    ...(skills ? { skills } : {}),
    transcript: normalizeTranscript(obj.transcript),
    state: normalizeState(obj.state),
  }
}

export function normalizeContinuitySkills(input: unknown): ContinuitySkillsTree | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Record<string, unknown>
  const out: ContinuitySkillsTree = {}
  let count = 0
  const tryInsert = (key: string, rawValue: unknown): void => {
    if (count >= MAX_PRIVATE_SKILL_ENTRIES) return
    if (typeof rawValue !== 'string') return
    if (key.length === 0 || key.length > MAX_PRIVATE_SKILL_PATH_LEN) return
    if (key.includes('\0')) return
    if (key.includes('..')) return
    if (key.startsWith('/')) return
    if (/^[A-Za-z]:/.test(key)) return
    if (!isAcceptableSkillKey(key)) return
    if (Buffer.byteLength(rawValue, 'utf8') > MAX_PRIVATE_SKILL_BODY_BYTES) return
    if (out[key] !== undefined) return
    out[key] = rawValue
    count++
  }
  const legacyRoots = new Set<string>()
  const realSkillFolders = new Set<string>()
  for (const rawKey of Object.keys(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    const segments = key.split('/')
    if (segments.length === 3 && segments[2] === 'SKILL.md' && segments[0] && segments[1]) {
      legacyRoots.add(`${segments[0]}/${segments[1]}`)
    }
    if (segments.length === 2 && segments[1] === 'SKILL.md' && segments[0]) {
      realSkillFolders.add(segments[0])
    }
  }
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    if (!isCanonicalFlatKey(key)) continue
    if (isUnderLegacyRoot(key, legacyRoots)) continue
    if (!keyHasRealSkillFolder(key, realSkillFolders)) continue
    tryInsert(key, rawValue)
  }
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = rawKey.replace(/\\/g, '/')
    if (
      isCanonicalFlatKey(key)
      && !isUnderLegacyRoot(key, legacyRoots)
      && keyHasRealSkillFolder(key, realSkillFolders)
    ) continue
    const upgraded = upgradeLegacySkillKey(key, legacyRoots)
    if (!upgraded) continue
    tryInsert(upgraded, rawValue)
  }
  return count > 0 ? out : undefined
}

function isUnderLegacyRoot(key: string, legacyRoots: Set<string>): boolean {
  for (const root of legacyRoots) {
    if (key === `${root}/SKILL.md`) return true
    if (key.startsWith(`${root}/`)) return true
  }
  return false
}

function keyHasRealSkillFolder(key: string, realSkillFolders: Set<string>): boolean {
  const first = key.split('/')[0]
  if (!first) return false
  return realSkillFolders.has(first)
}

function isCanonicalFlatKey(key: string): boolean {
  if (!PRIVATE_SKILL_FILE_RE.test(key)) return false
  const segments = key.split('/')
  if (segments.length < 2) return false
  const last = segments[segments.length - 1]!
  if (last === 'SKILL.md') return segments.length === 2
  return PRIVATE_SKILL_LAST_SEG_FILE_RE.test(last)
}

function isAcceptableSkillKey(key: string): boolean {
  return isCanonicalFlatKey(key)
}

function upgradeLegacySkillKey(key: string, legacyRoots: Set<string>): string | null {
  for (const root of legacyRoots) {
    if (key === `${root}/SKILL.md` || key.startsWith(`${root}/`)) {
      const [first, second] = root.split('/')
      if (!first || !second) continue
      const rest = key.slice(root.length + 1)
      const flattened = `${first}-${second}/${rest}`
      return isCanonicalFlatKey(flattened) ? flattened : null
    }
  }
  if (LEGACY_FLAT_NAME_MD_RE.test(key)) {
    const [category, file] = key.split('/')
    if (!category || !file) return null
    const slug = file.replace(/\.md$/i, '')
    if (!slug) return null
    const flattened = `${category}-${slug}/SKILL.md`
    return isCanonicalFlatKey(flattened) ? flattened : null
  }
  if (LEGACY_NESTED_SKILL_RE.test(key)) {
    const segments = key.split('/')
    if (segments.length < 3) return null
    const [first, second, ...rest] = segments
    if (!first || !second || rest.length === 0) return null
    const flattened = `${first}-${second}/${rest.join('/')}`
    return isCanonicalFlatKey(flattened) ? flattened : null
  }
  if (isCanonicalFlatKey(key)) return key
  return null
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
    throw new Error('Continuity snapshot files are invalid')
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

function normalizeContinuitySnapshotToken(input: unknown): ContinuitySnapshotToken {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Continuity snapshot token is invalid')
  }
  const obj = input as Partial<ContinuitySnapshotToken>
  if (typeof obj.chainId !== 'number' || !Number.isSafeInteger(obj.chainId) || obj.chainId <= 0) {
    throw new Error('Continuity snapshot token chain is invalid')
  }
  if (typeof obj.identityRegistryAddress !== 'string') {
    throw new Error('Continuity snapshot token registry is invalid')
  }
  if (typeof obj.agentId !== 'string' || !/^\d+$/.test(obj.agentId)) {
    throw new Error('Continuity snapshot token id is invalid')
  }
  return {
    chainId: obj.chainId,
    identityRegistryAddress: toChecksumAddress(obj.identityRegistryAddress),
    agentId: obj.agentId,
  }
}

function normalizeTransferSlot(input: unknown, expectedAddress: string): TransferContinuitySnapshotSlot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Continuity transfer slot is invalid')
  }
  const obj = input as Partial<TransferContinuitySnapshotSlot>
  if (typeof obj.address !== 'string') throw new Error('Continuity transfer slot address is invalid')
  const address = toChecksumAddress(obj.address)
  if (address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error('Continuity transfer slot address mismatch')
  }
  if (typeof obj.challenge !== 'string') throw new Error('Continuity transfer slot challenge is invalid')
  if (typeof obj.salt !== 'string') throw new Error('Continuity transfer slot salt is invalid')
  if (typeof obj.nonce !== 'string') throw new Error('Continuity transfer slot nonce is invalid')
  if (typeof obj.encryptedKey !== 'string') throw new Error('Continuity transfer slot key is invalid')
  if (typeof obj.tag !== 'string') throw new Error('Continuity transfer slot tag is invalid')
  return {
    address,
    challenge: obj.challenge,
    salt: obj.salt,
    nonce: obj.nonce,
    encryptedKey: obj.encryptedKey,
    tag: obj.tag,
  }
}

function normalizeWalletRestoreAccessKeys(input: unknown): WalletContinuityRestoreAccessKey[] {
  if (!Array.isArray(input)) return []
  const out: WalletContinuityRestoreAccessKey[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const key = normalizeWalletRestoreAccessKey(item)
    const dedupe = key.address.toLowerCase()
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    out.push(key)
  }
  return out.sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()))
}

function normalizeWalletRestoreAccessKey(input: unknown): WalletContinuityRestoreAccessKey {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Wallet restore access key is invalid')
  }
  const obj = input as Partial<WalletContinuityRestoreAccessKey>
  if (typeof obj.address !== 'string') throw new Error('Wallet restore access address is invalid')
  if (typeof obj.challenge !== 'string') throw new Error('Wallet restore access challenge is invalid')
  if (typeof obj.salt !== 'string') throw new Error('Wallet restore access salt is invalid')
  if (typeof obj.kemPublicKey !== 'string') throw new Error('Wallet restore access public key is invalid')
  return {
    address: toChecksumAddress(obj.address),
    challenge: obj.challenge,
    salt: obj.salt,
    kemPublicKey: obj.kemPublicKey,
    ...(typeof obj.createdAt === 'string' ? { createdAt: obj.createdAt } : {}),
  }
}

function normalizeWalletSlot(input: unknown): WalletContinuitySnapshotSlot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Continuity wallet slot is invalid')
  }
  const obj = input as Partial<WalletContinuitySnapshotSlot>
  if (typeof obj.address !== 'string') throw new Error('Continuity wallet slot address is invalid')
  if (typeof obj.challenge !== 'string') throw new Error('Continuity wallet slot challenge is invalid')
  if (typeof obj.salt !== 'string') throw new Error('Continuity wallet slot salt is invalid')
  if (typeof obj.kemPublicKey !== 'string') throw new Error('Continuity wallet slot public key is invalid')
  if (typeof obj.kemCiphertext !== 'string') throw new Error('Continuity wallet slot ciphertext is invalid')
  if (typeof obj.nonce !== 'string') throw new Error('Continuity wallet slot nonce is invalid')
  if (typeof obj.encryptedKey !== 'string') throw new Error('Continuity wallet slot key is invalid')
  if (typeof obj.tag !== 'string') throw new Error('Continuity wallet slot tag is invalid')
  return {
    address: toChecksumAddress(obj.address),
    challenge: obj.challenge,
    salt: obj.salt,
    kemPublicKey: obj.kemPublicKey,
    kemCiphertext: obj.kemCiphertext,
    nonce: obj.nonce,
    encryptedKey: obj.encryptedKey,
    tag: obj.tag,
  }
}

function assertPayloadMatchesEnvelope(payload: ContinuitySnapshotPayload, ownerAddress: string, createdAt: string): void {
  if (payload.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error('Continuity snapshot owner mismatch')
  }
  if (payload.createdAt !== createdAt) {
    throw new Error('Continuity snapshot timestamp mismatch')
  }
}

function assertSignatureForAddress(challenge: string, signature: string, address: string): void {
  const recovered = recoverAddressFromSignature(challenge, signature)
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Wallet signature does not match continuity snapshot owner')
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

function deriveTransferSlotKey(walletSignature: string, salt: Uint8Array, address: string, challenge: string): Buffer {
  return Buffer.from(hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:transfer-slot:${address.toLowerCase()}:${sha256Hex(challenge)}`,
    32,
  ))
}

function deriveWalletRestoreKemSeed(walletSignature: string, salt: Uint8Array, address: string, challenge: string): Uint8Array {
  return hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:wallet-restore-kem:${address.toLowerCase()}:${sha256Hex(challenge)}`,
    64,
  )
}

function deriveWalletSlotAesKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  address: string,
  challenge: string,
  accessManifestHash: string,
): Buffer {
  return Buffer.from(hkdf(
    sharedSecret,
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:wallet-slot:${address.toLowerCase()}:${sha256Hex(challenge)}:${accessManifestHash}`,
    32,
  ))
}

function continuityAadFor(ownerAddress: string, createdAt: string): Buffer {
  return Buffer.from(`${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}\n${ownerAddress.toLowerCase()}\n${createdAt}`, 'utf8')
}

function walletAccessManifestHash(args: {
  ownerAddress: string
  token: ContinuitySnapshotToken
  accessEpoch: number
  accessKeys: WalletContinuityRestoreAccessKey[]
}): string {
  const token = normalizeContinuitySnapshotToken(args.token)
  const accessKeys = normalizeWalletRestoreAccessKeys(args.accessKeys)
  return sha256Hex(JSON.stringify({
    ownerAddress: toChecksumAddress(args.ownerAddress).toLowerCase(),
    token: {
      chainId: token.chainId,
      identityRegistryAddress: token.identityRegistryAddress.toLowerCase(),
      agentId: token.agentId,
    },
    accessEpoch: args.accessEpoch,
    wallets: accessKeys.map(key => ({
      address: key.address.toLowerCase(),
      challengeHash: sha256Hex(key.challenge),
      salt: key.salt,
      kemPublicKey: key.kemPublicKey,
    })),
  }))
}

function walletPayloadAadFor(args: {
  ownerAddress: string
  createdAt: string
  token: ContinuitySnapshotToken
  accessEpoch: number
  accessManifestHash: string
}): Buffer {
  const token = normalizeContinuitySnapshotToken(args.token)
  return Buffer.from([
    CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
    'wallet-signature-slots',
    args.ownerAddress.toLowerCase(),
    args.createdAt,
    String(token.chainId),
    token.identityRegistryAddress.toLowerCase(),
    token.agentId,
    String(args.accessEpoch),
    args.accessManifestHash,
  ].join('\n'), 'utf8')
}

function transferPayloadAadFor(args: {
  ownerAddress: string
  targetAddress: string
  createdAt: string
  token: ContinuitySnapshotToken
}): Buffer {
  const token = normalizeContinuitySnapshotToken(args.token)
  return Buffer.from([
    CONTINUITY_SNAPSHOT_ENVELOPE_VERSION,
    'transfer',
    args.ownerAddress.toLowerCase(),
    args.targetAddress.toLowerCase(),
    args.createdAt,
    String(token.chainId),
    token.identityRegistryAddress.toLowerCase(),
    token.agentId,
  ].join('\n'), 'utf8')
}

function walletSlotAadFor(slot: Pick<WalletContinuitySnapshotSlot, 'address' | 'challenge' | 'kemPublicKey' | 'kemCiphertext'>, payloadAad: Buffer): Buffer {
  return Buffer.concat([
    payloadAad,
    Buffer.from([
      '',
      'wallet-slot',
      slot.address.toLowerCase(),
      sha256Hex(slot.challenge),
      slot.kemPublicKey,
      slot.kemCiphertext,
    ].join('\n'), 'utf8'),
  ])
}

function transferSlotAadFor(slot: Pick<TransferContinuitySnapshotSlot, 'address' | 'challenge'>, payloadAad: Buffer): Buffer {
  return Buffer.concat([
    payloadAad,
    Buffer.from(`\nslot\n${slot.address.toLowerCase()}\n${sha256Hex(slot.challenge)}`, 'utf8'),
  ])
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), length))
}

function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}
