import { AsyncLocalStorage } from 'node:async_hooks'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { EthagentIdentity } from '../../storage/config.js'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import { continuityVaultRef } from './storage/paths.js'
import { packedFileMap, type PackedSources } from './storage/packed.js'

type IdentityKey = Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'agentId' | 'address'>

export type StoreEntry = { sha256: string; size: number; forgotten?: true }

export type SnapshotSource = 'save' | 'restore' | 'fetch'

export type SnapshotManifest = {
  version: 1
  kind: 'snapshot'
  cid: string
  createdAt: string
  source: SnapshotSource
  agentCardCid?: string
  files: Record<string, StoreEntry>
}

export type LockReason =
  | 'no-slot'
  | 'owner-only'
  | 'transfer-parties-only'
  | 'signature-mismatch'
  | 'state-only'
  | 'unsupported'

export type LockedManifest = {
  version: 1
  kind: 'locked'
  cid: string
  reason: LockReason
  keyAddress?: string
  slots?: string[]
  checkedAt: string
}

export type CheckpointReason = 'manual' | 'pre-rollback' | 'pre-restore'

export type CheckpointManifest = {
  version: 1
  kind: 'checkpoint'
  id: string
  createdAt: string
  reason: CheckpointReason
  scope: 'vault' | 'paths'
  label?: string
  target?: string
  files: Record<string, StoreEntry>
  absent: string[]
}

type Tombstones = { version: 1; shas: string[]; cids: string[] }

export class StoreCorruptError extends Error {
  constructor(readonly sha: string) {
    super(`snapshot store object ${sha} failed its sha256 check; run \`ethagent forget\` on the affected snapshot and fetch it again`)
    this.name = 'StoreCorruptError'
  }
}

export class StoreBusyError extends Error {
  constructor() {
    super('another ethagent process is writing the snapshot store; retry in a moment')
    this.name = 'StoreBusyError'
  }
}

const SHA_RE = /^[0-9a-f]{64}$/
const STALE_EMPTY_LOCK_MS = 10_000
const lockContext = new AsyncLocalStorage<ReadonlySet<string>>()
const lockQueues = new Map<string, Promise<void>>()

export function sha256Hex(bytes: Uint8Array | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

export function snapshotStoreDir(identity: IdentityKey): string {
  return path.join(continuityVaultRef(identity).dir, '.snapshots')
}

function objectPath(identity: IdentityKey, sha: string): string {
  return path.join(snapshotStoreDir(identity), 'objects', sha)
}

function manifestPath(identity: IdentityKey, cid: string): string {
  return path.join(snapshotStoreDir(identity), 'manifests', `${sha256Hex(cid.trim())}.json`)
}

function checkpointPath(identity: IdentityKey, id: string): string {
  return path.join(snapshotStoreDir(identity), 'checkpoints', `${id}.json`)
}

function tombstonesPath(identity: IdentityKey): string {
  return path.join(snapshotStoreDir(identity), 'forgotten.json')
}

function lockPath(identity: IdentityKey): string {
  return path.join(snapshotStoreDir(identity), 'lock')
}

async function ensureStoreDirs(identity: IdentityKey): Promise<void> {
  const root = snapshotStoreDir(identity)
  for (const sub of ['objects', 'manifests', 'checkpoints']) {
    await fs.mkdir(path.join(root, sub), { recursive: true, mode: 0o700 })
  }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (err instanceof SyntaxError) return null
    throw err
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await atomicWriteText(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function readTombstones(identity: IdentityKey): Promise<Tombstones> {
  const raw = await readJson(tombstonesPath(identity)) as Partial<Tombstones> | null
  return {
    version: 1,
    shas: Array.isArray(raw?.shas) ? raw.shas.filter(sha => typeof sha === 'string' && SHA_RE.test(sha)) : [],
    cids: Array.isArray(raw?.cids) ? raw.cids.filter(cid => typeof cid === 'string') : [],
  }
}

export async function isForgottenCid(identity: IdentityKey, cid: string): Promise<boolean> {
  return (await readTombstones(identity)).cids.includes(cid)
}

async function putObject(identity: IdentityKey, bytes: Uint8Array, tombstoned: ReadonlySet<string>): Promise<StoreEntry> {
  const sha = sha256Hex(bytes)
  if (tombstoned.has(sha)) return { sha256: sha, size: bytes.length, forgotten: true }
  const file = objectPath(identity, sha)
  try {
    await fs.access(file)
  } catch {
    await atomicWriteText(file, bytes, { mode: 0o600 })
  }
  return { sha256: sha, size: bytes.length }
}

export async function readObject(identity: IdentityKey, sha: string): Promise<Uint8Array | null> {
  if (!SHA_RE.test(sha)) return null
  let bytes: Buffer
  try {
    bytes = await fs.readFile(objectPath(identity, sha))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (sha256Hex(bytes) !== sha) throw new StoreCorruptError(sha)
  return new Uint8Array(bytes)
}

export async function readEntryBytes(identity: IdentityKey, entries: Record<string, StoreEntry>): Promise<{
  files: Record<string, Uint8Array>
  forgotten: string[]
  missing: string[]
}> {
  const files: Record<string, Uint8Array> = {}
  const forgotten: string[] = []
  const missing: string[] = []
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.forgotten) {
      forgotten.push(key)
      continue
    }
    const bytes = await readObject(identity, entry.sha256)
    if (bytes) files[key] = bytes
    else missing.push(key)
  }
  return { files, forgotten, missing }
}

function isSnapshotManifest(value: unknown): value is SnapshotManifest | LockedManifest {
  if (!value || typeof value !== 'object') return false
  const obj = value as { version?: unknown; kind?: unknown; cid?: unknown }
  return obj.version === 1 && (obj.kind === 'snapshot' || obj.kind === 'locked') && typeof obj.cid === 'string'
}

function isCheckpointManifest(value: unknown): value is CheckpointManifest {
  if (!value || typeof value !== 'object') return false
  const obj = value as { version?: unknown; kind?: unknown; id?: unknown }
  return obj.version === 1 && obj.kind === 'checkpoint' && typeof obj.id === 'string'
}

export async function readSnapshotManifest(identity: IdentityKey, cid: string): Promise<SnapshotManifest | LockedManifest | null> {
  const raw = await readJson(manifestPath(identity, cid))
  return isSnapshotManifest(raw) && raw.cid === cid ? raw : null
}

export async function listSnapshotManifests(identity: IdentityKey): Promise<Array<SnapshotManifest | LockedManifest>> {
  const dir = path.join(snapshotStoreDir(identity), 'manifests')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: Array<SnapshotManifest | LockedManifest> = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const raw = await readJson(path.join(dir, name))
    if (isSnapshotManifest(raw)) out.push(raw)
  }
  return out
}

export async function putSnapshot(
  identity: IdentityKey,
  cid: string,
  sources: PackedSources,
  meta: { source: SnapshotSource; createdAt?: string; agentCardCid?: string },
  opts: { waitMs?: number } = {},
): Promise<SnapshotManifest> {
  return withStoreLock(identity, async () => {
    const existing = await readSnapshotManifest(identity, cid)
    if (existing?.kind === 'snapshot') return existing
    await ensureStoreDirs(identity)
    const tombstoned = new Set((await readTombstones(identity)).shas)
    const map = packedFileMap(sources)
    const files: Record<string, StoreEntry> = {}
    for (const key of Object.keys(map).sort()) {
      files[key] = await putObject(identity, Buffer.from(map[key]!, 'utf8'), tombstoned)
    }
    const manifest: SnapshotManifest = {
      version: 1,
      kind: 'snapshot',
      cid,
      createdAt: meta.createdAt ?? new Date().toISOString(),
      source: meta.source,
      ...(meta.agentCardCid ? { agentCardCid: meta.agentCardCid } : {}),
      files,
    }
    await writeJson(manifestPath(identity, cid), manifest)
    return manifest
  }, opts)
}

export async function putLocked(
  identity: IdentityKey,
  cid: string,
  info: { reason: LockReason; keyAddress?: string; slots?: string[] },
  opts: { waitMs?: number } = {},
): Promise<LockedManifest | null> {
  return withStoreLock(identity, async () => {
    const existing = await readSnapshotManifest(identity, cid)
    if (existing?.kind === 'snapshot') return null
    await ensureStoreDirs(identity)
    const manifest: LockedManifest = {
      version: 1,
      kind: 'locked',
      cid,
      reason: info.reason,
      ...(info.keyAddress ? { keyAddress: info.keyAddress } : {}),
      ...(info.slots && info.slots.length > 0 ? { slots: info.slots } : {}),
      checkedAt: new Date().toISOString(),
    }
    await writeJson(manifestPath(identity, cid), manifest)
    return manifest
  }, opts)
}

export async function putCheckpoint(
  identity: IdentityKey,
  input: {
    reason: CheckpointReason
    scope: 'vault' | 'paths'
    files: Record<string, Uint8Array>
    absent?: string[]
    label?: string
    target?: string
    now?: Date
  },
): Promise<CheckpointManifest> {
  return withStoreLock(identity, async () => {
    await ensureStoreDirs(identity)
    const tombstoned = new Set((await readTombstones(identity)).shas)
    const files: Record<string, StoreEntry> = {}
    for (const key of Object.keys(input.files).sort()) {
      files[key] = await putObject(identity, input.files[key]!, tombstoned)
    }
    const createdAt = (input.now ?? new Date()).toISOString()
    const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    const id = `cp-${stamp}-${crypto.randomBytes(2).toString('hex')}`
    const manifest: CheckpointManifest = {
      version: 1,
      kind: 'checkpoint',
      id,
      createdAt,
      reason: input.reason,
      scope: input.scope,
      ...(input.label ? { label: input.label } : {}),
      ...(input.target ? { target: input.target } : {}),
      files,
      absent: [...(input.absent ?? [])].sort(),
    }
    await writeJson(checkpointPath(identity, id), manifest)
    return manifest
  })
}

export async function listCheckpoints(identity: IdentityKey): Promise<CheckpointManifest[]> {
  const dir = path.join(snapshotStoreDir(identity), 'checkpoints')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: CheckpointManifest[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const raw = await readJson(path.join(dir, name))
    if (isCheckpointManifest(raw)) out.push(raw)
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export async function forgetContent(
  identity: IdentityKey,
  shas: string[],
): Promise<{ objects: number; manifests: number; checkpoints: number }> {
  return withStoreLock(identity, async () => {
    const targets = new Set(shas.filter(sha => SHA_RE.test(sha)))
    const tombstones = await readTombstones(identity)
    await ensureStoreDirs(identity)
    await writeJson(tombstonesPath(identity), {
      ...tombstones,
      shas: [...new Set([...tombstones.shas, ...targets])].sort(),
    })
    let objects = 0
    for (const sha of targets) {
      try {
        await fs.unlink(objectPath(identity, sha))
        objects++
      } catch {}
    }
    const markForgotten = (files: Record<string, StoreEntry>): boolean => {
      let changed = false
      for (const entry of Object.values(files)) {
        if (targets.has(entry.sha256) && !entry.forgotten) {
          entry.forgotten = true
          changed = true
        }
      }
      return changed
    }
    let manifests = 0
    for (const manifest of await listSnapshotManifests(identity)) {
      if (manifest.kind !== 'snapshot' || !markForgotten(manifest.files)) continue
      await writeJson(manifestPath(identity, manifest.cid), manifest)
      manifests++
    }
    let checkpoints = 0
    for (const checkpoint of await listCheckpoints(identity)) {
      if (!markForgotten(checkpoint.files)) continue
      await writeJson(checkpointPath(identity, checkpoint.id), checkpoint)
      checkpoints++
    }
    return { objects, manifests, checkpoints }
  })
}

export async function forgetSnapshot(identity: IdentityKey, cid: string): Promise<{ objects: number }> {
  return withStoreLock(identity, async () => {
    const tombstones = await readTombstones(identity)
    await ensureStoreDirs(identity)
    await writeJson(tombstonesPath(identity), {
      ...tombstones,
      cids: [...new Set([...tombstones.cids, cid])].sort(),
    })
    await fs.rm(manifestPath(identity, cid), { force: true })
    return { objects: await collectGarbage(identity) }
  })
}

export async function forgetCheckpoint(identity: IdentityKey, id: string): Promise<{ objects: number }> {
  return withStoreLock(identity, async () => {
    await fs.rm(checkpointPath(identity, id), { force: true })
    return { objects: await collectGarbage(identity) }
  })
}

export async function forgetEverything(identity: IdentityKey): Promise<{ objects: number; manifests: number; checkpoints: number }> {
  return withStoreLock(identity, async () => {
    const root = snapshotStoreDir(identity)
    const counts = { objects: 0, manifests: 0, checkpoints: 0 }
    for (const sub of ['objects', 'manifests', 'checkpoints'] as const) {
      const names = await fs.readdir(path.join(root, sub)).catch(() => [] as string[])
      for (const name of names) {
        await fs.rm(path.join(root, sub, name), { force: true })
        counts[sub]++
      }
    }
    return counts
  })
}

async function collectGarbage(identity: IdentityKey): Promise<number> {
  const referenced = new Set<string>()
  for (const manifest of await listSnapshotManifests(identity)) {
    if (manifest.kind !== 'snapshot') continue
    for (const entry of Object.values(manifest.files)) referenced.add(entry.sha256)
  }
  for (const checkpoint of await listCheckpoints(identity)) {
    for (const entry of Object.values(checkpoint.files)) referenced.add(entry.sha256)
  }
  const dir = path.join(snapshotStoreDir(identity), 'objects')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  let removed = 0
  for (const name of names) {
    if (referenced.has(name)) continue
    await fs.rm(path.join(dir, name), { force: true })
    removed++
  }
  return removed
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function lockIsStale(file: string): Promise<boolean> {
  const raw = await fs.readFile(file, 'utf8').catch(() => null)
  if (raw === null) return true
  const holder = Number.parseInt(raw.trim(), 10)
  if (Number.isInteger(holder) && holder > 0) return holder === process.pid || !pidAlive(holder)
  const stat = await fs.stat(file).catch(() => null)
  return !stat || Date.now() - stat.mtimeMs > STALE_EMPTY_LOCK_MS
}

async function acquireLockFile(file: string, waitMs: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + waitMs
  while (true) {
    try {
      const handle = await fs.open(file, 'wx', 0o600)
      try {
        await handle.writeFile(`${process.pid}\n`)
      } finally {
        await handle.close()
      }
      return
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (await lockIsStale(file)) {
        await fs.rm(file, { force: true })
        continue
      }
      if (Date.now() >= deadline) throw new StoreBusyError()
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

export async function withStoreLock<T>(
  identity: IdentityKey,
  fn: () => Promise<T>,
  opts: { waitMs?: number } = {},
): Promise<T> {
  const file = lockPath(identity)
  const held = lockContext.getStore()
  if (held?.has(file)) return fn()
  const previous = lockQueues.get(file) ?? Promise.resolve()
  let release!: () => void
  const turn = new Promise<void>(resolve => { release = resolve })
  const tail = previous.then(() => turn)
  lockQueues.set(file, tail)
  await previous
  try {
    await acquireLockFile(file, opts.waitMs ?? 0)
    try {
      return await lockContext.run(new Set([...(held ?? []), file]), fn)
    } finally {
      await fs.rm(file, { force: true }).catch(() => undefined)
    }
  } finally {
    release()
    if (lockQueues.get(file) === tail) lockQueues.delete(file)
  }
}
