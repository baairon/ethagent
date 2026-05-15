import { toChecksumAddress } from '../crypto/eth.js'
import { normalizeContinuitySkills } from './skillsNormalization.js'
import type {
  ContinuityAgentSnapshot,
  ContinuityFiles,
  ContinuitySnapshotPayload,
  TransferContinuitySnapshotSlot,
  WalletContinuityRestoreAccessKey,
  WalletContinuitySnapshotSlot,
} from './envelope.js'

type ContinuityTranscriptSummary = {
  sessionId?: string
  createdAt?: string
  summary: string
}

export function continuityPayloadFromArgs(args: {
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

export function normalizeContinuityPayload(input: unknown): ContinuitySnapshotPayload {
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

export function normalizeAgentSnapshot(input: unknown): ContinuityAgentSnapshot {
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

export function normalizeContinuityFiles(input: unknown): ContinuityFiles {
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

export function normalizeTranscript(input: unknown): ContinuityTranscriptSummary[] {
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

export function normalizeState(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

export function normalizeTransferSlot(input: unknown, expectedAddress: string): TransferContinuitySnapshotSlot {
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

export function normalizeWalletRestoreAccessKeys(input: unknown): WalletContinuityRestoreAccessKey[] {
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

export function normalizeWalletRestoreAccessKey(input: unknown): WalletContinuityRestoreAccessKey {
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

export function normalizeWalletSlot(input: unknown): WalletContinuitySnapshotSlot {
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
