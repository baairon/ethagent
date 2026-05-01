import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../../storage/config.js'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import {
  continuityVaultRef,
  ensureContinuityVault,
  localContinuitySnapshotContentHashes,
  type ContinuitySnapshotContentHashes,
} from './storage.js'

export type PublishedContinuitySnapshot = {
  version: 1
  id: string
  createdAt: string
  cid: string
  metadataCid?: string
  agentUri?: string
  txHash?: string
  publicSkillsCid?: string
  agentCardCid?: string
  contentHashes?: ContinuitySnapshotContentHashes
  label: string
  identity: {
    address: string
    ownerAddress?: string
    chainId?: number
    identityRegistryAddress?: string
    agentId?: string
  }
}

export type RecordPublishedContinuitySnapshotInput = {
  identity: EthagentIdentity
  label?: string
}

export function publishedContinuitySnapshotsPath(identity: EthagentIdentity): string {
  return path.join(continuityVaultRef(identity).dir, '.published-snapshots.jsonl')
}

export async function recordPublishedContinuitySnapshot(
  input: RecordPublishedContinuitySnapshotInput,
): Promise<PublishedContinuitySnapshot | null> {
  const backup = input.identity.backup
  if (!backup?.cid) return null
  await ensureContinuityVault(input.identity)
  const createdAt = backup.createdAt ?? new Date().toISOString()
  const contentHashes = await localContinuitySnapshotContentHashes(input.identity).catch(() => undefined)
  const snapshot: PublishedContinuitySnapshot = {
    version: 1,
    id: `${createdAt}:${backup.cid}`.replaceAll('\\', '/'),
    createdAt,
    cid: backup.cid,
    ...(backup.metadataCid ? { metadataCid: backup.metadataCid } : {}),
    ...(backup.agentUri ? { agentUri: backup.agentUri } : {}),
    ...(backup.txHash ? { txHash: backup.txHash } : {}),
    ...(input.identity.publicSkills?.cid ? { publicSkillsCid: input.identity.publicSkills.cid } : {}),
    ...(input.identity.publicSkills?.agentCardCid ? { agentCardCid: input.identity.publicSkills.agentCardCid } : {}),
    ...(contentHashes ? { contentHashes } : {}),
    label: input.label ?? 'published encrypted snapshot',
    identity: {
      address: input.identity.address,
      ...(input.identity.ownerAddress ? { ownerAddress: input.identity.ownerAddress } : {}),
      ...(input.identity.chainId ? { chainId: input.identity.chainId } : {}),
      ...(input.identity.identityRegistryAddress ? { identityRegistryAddress: input.identity.identityRegistryAddress } : {}),
      ...(input.identity.agentId ? { agentId: input.identity.agentId } : {}),
    },
  }

  const existing = await readPublishedContinuitySnapshotFile(input.identity)
  if (existing.some(item => item.cid === snapshot.cid)) return snapshot
  await fs.appendFile(publishedContinuitySnapshotsPath(input.identity), `${JSON.stringify(snapshot)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return snapshot
}

export async function updatePublishedContinuitySnapshotContentHashes(
  identity: EthagentIdentity,
  cid: string,
  contentHashes: ContinuitySnapshotContentHashes,
): Promise<void> {
  await ensureContinuityVault(identity)
  const current = currentPublishedSnapshot(identity)
  const snapshots = await readPublishedContinuitySnapshotFile(identity)
  const index = snapshots.findIndex(item => item.cid === cid)
  if (index === -1) {
    const base = current.find(item => item.cid === cid)
    if (!base) throw new Error('published snapshot was not found')
    snapshots.push({ ...base, contentHashes })
  } else {
    snapshots[index] = { ...snapshots[index]!, contentHashes }
  }
  await atomicWriteText(
    publishedContinuitySnapshotsPath(identity),
    snapshots.map(snapshot => JSON.stringify(snapshot)).join('\n') + '\n',
    { mode: 0o600 },
  )
}

export async function listPublishedContinuitySnapshots(
  identity: EthagentIdentity,
  limit = 30,
): Promise<PublishedContinuitySnapshot[]> {
  const snapshots = await readPublishedContinuitySnapshotFile(identity)

  for (const current of currentPublishedSnapshot(identity)) {
    const index = snapshots.findIndex(item => item.cid === current.cid)
    if (index === -1) {
      snapshots.push(current)
    } else {
      snapshots[index] = enrichPublishedSnapshot(snapshots[index]!, current)
    }
  }

  return snapshots
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

function enrichPublishedSnapshot(
  snapshot: PublishedContinuitySnapshot,
  current: PublishedContinuitySnapshot,
): PublishedContinuitySnapshot {
  return {
    ...snapshot,
    ...(snapshot.metadataCid ? {} : current.metadataCid ? { metadataCid: current.metadataCid } : {}),
    ...(snapshot.agentUri ? {} : current.agentUri ? { agentUri: current.agentUri } : {}),
    ...(snapshot.txHash ? {} : current.txHash ? { txHash: current.txHash } : {}),
    ...(snapshot.publicSkillsCid ? {} : current.publicSkillsCid ? { publicSkillsCid: current.publicSkillsCid } : {}),
    ...(snapshot.agentCardCid ? {} : current.agentCardCid ? { agentCardCid: current.agentCardCid } : {}),
    ...(snapshot.contentHashes ? {} : current.contentHashes ? { contentHashes: current.contentHashes } : {}),
  }
}

async function readPublishedContinuitySnapshotFile(identity: EthagentIdentity): Promise<PublishedContinuitySnapshot[]> {
  let raw: string
  try {
    raw = await fs.readFile(publishedContinuitySnapshotsPath(identity), 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const snapshots: PublishedContinuitySnapshot[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      snapshots.push(JSON.parse(trimmed) as PublishedContinuitySnapshot)
    } catch {
      continue
    }
  }
  return snapshots
}

function currentPublishedSnapshot(identity: EthagentIdentity): PublishedContinuitySnapshot[] {
  const backup = identity.backup
  if (!backup?.cid) return []
  const createdAt = backup.createdAt ?? identity.createdAt ?? new Date(0).toISOString()
  return [{
    version: 1,
    id: `${createdAt}:${backup.cid}`.replaceAll('\\', '/'),
    createdAt,
    cid: backup.cid,
    ...(backup.metadataCid ? { metadataCid: backup.metadataCid } : {}),
    ...(backup.agentUri ? { agentUri: backup.agentUri } : {}),
    ...(backup.txHash ? { txHash: backup.txHash } : {}),
    ...(identity.publicSkills?.cid ? { publicSkillsCid: identity.publicSkills.cid } : {}),
    ...(identity.publicSkills?.agentCardCid ? { agentCardCid: identity.publicSkills.agentCardCid } : {}),
    label: 'current published snapshot',
    identity: {
      address: identity.address,
      ...(identity.ownerAddress ? { ownerAddress: identity.ownerAddress } : {}),
      ...(identity.chainId ? { chainId: identity.chainId } : {}),
      ...(identity.identityRegistryAddress ? { identityRegistryAddress: identity.identityRegistryAddress } : {}),
      ...(identity.agentId ? { agentId: identity.agentId } : {}),
    },
  }]
}
