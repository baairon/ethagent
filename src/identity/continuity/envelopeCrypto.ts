import crypto from 'node:crypto'
import { toChecksumAddress } from '../crypto/eth.js'
import { normalizeContinuitySnapshotToken, type ContinuitySnapshotToken } from './snapshotToken.js'
import { normalizeWalletRestoreAccessKeys } from './payloadNormalization.js'
import { CONTINUITY_SNAPSHOT_ENVELOPE_VERSION } from './envelopeVersion.js'
import type {
  TransferContinuitySnapshotSlot,
  WalletContinuityRestoreAccessKey,
  WalletContinuitySnapshotSlot,
} from './envelope.js'

export function deriveContinuityKemSeed(walletSignature: string, salt: Uint8Array, ownerAddress: string): Uint8Array {
  return hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:ml-kem1024:${ownerAddress.toLowerCase()}`,
    64,
  )
}

export function deriveContinuityAesKey(
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

export function deriveTransferSlotKey(walletSignature: string, salt: Uint8Array, address: string, challenge: string): Buffer {
  return Buffer.from(hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:transfer-slot:${address.toLowerCase()}:${sha256Hex(challenge)}`,
    32,
  ))
}

export function deriveWalletRestoreKemSeed(walletSignature: string, salt: Uint8Array, address: string, challenge: string): Uint8Array {
  return hkdf(
    Buffer.from(walletSignature, 'utf8'),
    salt,
    `ethagent:${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}:wallet-restore-kem:${address.toLowerCase()}:${sha256Hex(challenge)}`,
    64,
  )
}

export function deriveWalletSlotAesKey(
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

export function continuityAadFor(ownerAddress: string, createdAt: string): Buffer {
  return Buffer.from(`${CONTINUITY_SNAPSHOT_ENVELOPE_VERSION}\n${ownerAddress.toLowerCase()}\n${createdAt}`, 'utf8')
}

export function walletAccessManifestHash(args: {
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

export function walletPayloadAadFor(args: {
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

export function transferPayloadAadFor(args: {
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

export function walletSlotAadFor(
  slot: Pick<WalletContinuitySnapshotSlot, 'address' | 'challenge' | 'kemPublicKey' | 'kemCiphertext'>,
  payloadAad: Buffer,
): Buffer {
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

export function transferSlotAadFor(
  slot: Pick<TransferContinuitySnapshotSlot, 'address' | 'challenge'>,
  payloadAad: Buffer,
): Buffer {
  return Buffer.concat([
    payloadAad,
    Buffer.from(`\nslot\n${slot.address.toLowerCase()}\n${sha256Hex(slot.challenge)}`, 'utf8'),
  ])
}

export function sha256Hex(value: string | Uint8Array): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function hkdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return new Uint8Array(crypto.hkdfSync('sha256', ikm, salt, Buffer.from(info, 'utf8'), length))
}
