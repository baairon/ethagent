import type { ContinuitySnapshotToken } from './snapshotToken.js'
import { CONTINUITY_SNAPSHOT_ENVELOPE_VERSION } from './envelopeVersion.js'

export type ContinuityFiles = {
  'SOUL.md': string
  'MEMORY.md': string
}

export type ContinuitySkillsTree = Record<string, string>

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
  skills?: ContinuitySkillsTree
  transcript: ContinuityTranscriptSummary[]
  state: Record<string, unknown>
}

export type TransferContinuitySnapshotSlot = {
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

export type WalletContinuitySnapshotSlot = {
  address: string
  challenge: string
  salt: string
  kemPublicKey: string
  kemCiphertext: string
  nonce: string
  encryptedKey: string
  tag: string
}

export type SignatureContinuitySnapshotEnvelope = {
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

export type WalletContinuitySnapshotEnvelope = {
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

export type CreateContinuitySnapshotEnvelopeArgs = {
  ownerAddress: string
  walletSignature: string
  payload: Omit<ContinuitySnapshotPayload, 'version' | 'ownerAddress' | 'createdAt'> & {
    createdAt?: string
  }
}

export type CreateTransferContinuitySnapshotEnvelopeArgs = {
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

export type CreateWalletContinuitySnapshotEnvelopeArgs = {
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

export type RestoreContinuitySnapshotEnvelopeArgs = {
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
