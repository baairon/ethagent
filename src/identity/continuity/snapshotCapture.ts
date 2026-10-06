import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../../storage/config.js'
import type { ContinuityFiles, ContinuitySkillsTree } from './envelope.js'
import { isBuildCacheName, MAX_FOLDER_DEPTH } from './skills/skillPaths.js'
import { continuityVaultRef } from './storage/paths.js'
import {
  putCheckpoint,
  putSnapshot,
  type CheckpointManifest,
  type CheckpointReason,
  type SnapshotSource,
} from './snapshotStore.js'

const CAPTURE_LOCK_WAIT_MS = 2000
const MAX_RAW_CHECKPOINT_FILE_BYTES = 8 * 1024 * 1024

export async function captureSnapshot(
  identity: EthagentIdentity,
  cid: string | undefined,
  sources: { privateFiles: ContinuityFiles; agentCard?: string | null; skills?: ContinuitySkillsTree },
  meta: { source: SnapshotSource; createdAt?: string; agentCardCid?: string },
): Promise<void> {
  if (!cid) return
  await putSnapshot(
    identity,
    cid,
    {
      privateFiles: sources.privateFiles,
      ...(typeof sources.agentCard === 'string' ? { agentCard: sources.agentCard } : {}),
      ...(sources.skills ? { skills: sources.skills } : {}),
    },
    meta,
    { waitMs: CAPTURE_LOCK_WAIT_MS },
  ).catch(() => null)
}

export async function readVaultRawFiles(identity: EthagentIdentity): Promise<Record<string, Uint8Array>> {
  const ref = continuityVaultRef(identity)
  const out: Record<string, Uint8Array> = {}
  for (const [key, file] of [['SOUL.md', ref.soulPath], ['MEMORY.md', ref.memoryPath]] as const) {
    const bytes = await fs.readFile(file).catch(() => null)
    if (bytes) out[key] = new Uint8Array(bytes)
  }
  await walkRaw(ref.skillsDir, 'skills/', 0, out)
  return out
}

async function walkRaw(dir: string, prefix: string, depth: number, out: Record<string, Uint8Array>): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH + 1) return
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    if (ent.isSymbolicLink() || ent.name.startsWith('.') || isBuildCacheName(ent.name)) continue
    const abs = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      await walkRaw(abs, `${prefix}${ent.name}/`, depth + 1, out)
      continue
    }
    if (!ent.isFile()) continue
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || stat.size > MAX_RAW_CHECKPOINT_FILE_BYTES) continue
    const bytes = await fs.readFile(abs).catch(() => null)
    if (bytes) out[`${prefix}${ent.name}`] = new Uint8Array(bytes)
  }
}

export async function checkpointVault(
  identity: EthagentIdentity,
  reason: CheckpointReason,
  extra: { label?: string; target?: string } = {},
): Promise<CheckpointManifest | null> {
  const files = await readVaultRawFiles(identity)
  if (Object.keys(files).length === 0) return null
  return putCheckpoint(identity, { reason, scope: 'vault', files, ...extra })
}

export async function checkpointBeforeRestore(identity: EthagentIdentity, target?: string): Promise<void> {
  await checkpointVault(identity, 'pre-restore', target ? { target } : {}).catch(() => null)
}
