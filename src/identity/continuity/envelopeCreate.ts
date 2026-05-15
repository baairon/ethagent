import crypto from 'node:crypto'
import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js'
import { toChecksumAddress } from '../crypto/eth.js'
import {
  createContinuitySnapshotChallenge,
  createTransferContinuitySnapshotChallenge,
  createWalletRestoreAccessChallenge,
  type WalletChallengePurpose,
} from './challenges.js'
import { normalizeContinuitySnapshotToken, type ContinuitySnapshotToken } from './snapshotToken.js'
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
  walletAccessManifestHash,
  walletPayloadAadFor,
  walletSlotAadFor,
} from './envelopeCrypto.js'
import {
  continuityPayloadFromArgs,
  normalizeAgentSnapshot,
  normalizeWalletRestoreAccessKey,
  normalizeWalletRestoreAccessKeys,
} from './payloadNormalization.js'
import { assertSignatureForAddress } from './envelopeParse.js'
import type {
  CreateContinuitySnapshotEnvelopeArgs,
  CreateTransferContinuitySnapshotEnvelopeArgs,
  CreateWalletContinuitySnapshotEnvelopeArgs,
  SignatureContinuitySnapshotEnvelope,
  TransferContinuitySnapshotEnvelope,
  TransferContinuitySnapshotSlot,
  WalletContinuityRestoreAccessKey,
  WalletContinuitySnapshotEnvelope,
  WalletContinuitySnapshotSlot,
} from './envelopeTypes.js'

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
