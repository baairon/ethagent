import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../../storage/config.js'
import {
  continuityVaultRef,
  ensureContinuityVault,
  type PrivateContinuityFile,
} from './storage.js'

export type PrivateContinuityHistorySnapshot = {
  version: 1
  id: string
  createdAt: string
  file: PrivateContinuityFile
  filePath: string
  existedBefore: boolean
  previousContent: string
  changeSummary: string
  identity: {
    address: string
    ownerAddress?: string
    chainId?: number
    identityRegistryAddress?: string
    agentId?: string
  }
  sessionId?: string
  turnId?: string
  promptSnippet?: string
  checkpointLabel?: string
}

export type RecordPrivateContinuityHistoryInput = {
  identity: EthagentIdentity
  file: PrivateContinuityFile
  filePath: string
  existedBefore: boolean
  previousContent: string
  changeSummary: string
  createdAt?: string
  sessionId?: string
  turnId?: string
  promptSnippet?: string
  checkpointLabel?: string
}

export function privateContinuityHistoryPath(identity: EthagentIdentity): string {
  return path.join(continuityVaultRef(identity).dir, '.history.jsonl')
}

export async function recordPrivateContinuityHistorySnapshot(
  input: RecordPrivateContinuityHistoryInput,
): Promise<PrivateContinuityHistorySnapshot> {
  await ensureContinuityVault(input.identity)
  const createdAt = input.createdAt ?? new Date().toISOString()
  const snapshot: PrivateContinuityHistorySnapshot = {
    version: 1,
    id: `${createdAt}:${input.file}`.replaceAll('\\', '/'),
    createdAt,
    file: input.file,
    filePath: path.resolve(input.filePath),
    existedBefore: input.existedBefore,
    previousContent: input.previousContent,
    changeSummary: input.changeSummary,
    identity: {
      address: input.identity.address,
      ...(input.identity.ownerAddress ? { ownerAddress: input.identity.ownerAddress } : {}),
      ...(input.identity.chainId ? { chainId: input.identity.chainId } : {}),
      ...(input.identity.identityRegistryAddress ? { identityRegistryAddress: input.identity.identityRegistryAddress } : {}),
      ...(input.identity.agentId ? { agentId: input.identity.agentId } : {}),
    },
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.promptSnippet ? { promptSnippet: normalizeSnippet(input.promptSnippet) } : {}),
    ...(input.checkpointLabel ? { checkpointLabel: normalizeSnippet(input.checkpointLabel) } : {}),
  }
  await fs.appendFile(privateContinuityHistoryPath(input.identity), `${JSON.stringify(snapshot)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return snapshot
}

export async function listPrivateContinuityHistory(
  identity: EthagentIdentity,
  limit = 30,
): Promise<PrivateContinuityHistorySnapshot[]> {
  let raw: string
  try {
    raw = await fs.readFile(privateContinuityHistoryPath(identity), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const snapshots: PrivateContinuityHistorySnapshot[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      snapshots.push(JSON.parse(trimmed) as PrivateContinuityHistorySnapshot)
    } catch {
      continue
    }
  }
  return snapshots.reverse().slice(0, limit)
}

function normalizeSnippet(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim()
  return normalized.length <= 120 ? normalized : `${normalized.slice(0, 117)}...`
}
