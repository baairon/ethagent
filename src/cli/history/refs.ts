import type { EthagentIdentity } from '../../storage/config.js'
import type { PublishedContinuitySnapshot } from '../../identity/continuity/snapshots.js'
import {
  listCheckpoints,
  readEntryBytes,
  readSnapshotManifest,
  type CheckpointManifest,
} from '../../identity/continuity/snapshotStore.js'
import { readPackedWorkingView, type PackedWorkingView } from '../../identity/continuity/storage/packed.js'
import { ensureTrailingNewline } from '../../identity/continuity/storage/files.js'
import { localKeySigner, type ChallengeSigner } from '../../identity/continuity/localKeyDecrypt.js'
import { fetchSnapshotIntoStore } from '../../identity/continuity/snapshotFetch.js'
import { DEFAULT_IPFS_API_URL } from '../../identity/storage/ipfs.js'
import { detectSyncTargets, planSoulMemoryReconcile } from '../sync.js'
import { readOperatorKey } from '../operatorKey.js'
import { HistoryError, type HistoryDeps } from './shared.js'

export type ResolvedRef =
  | { kind: 'working'; label: string }
  | { kind: 'snapshot'; label: string; cid: string; createdAt: string; index: number; entry: PublishedContinuitySnapshot }
  | { kind: 'checkpoint'; label: string; checkpoint: CheckpointManifest }

export type HistoryContext = {
  identity: EthagentIdentity
  ledger: PublishedContinuitySnapshot[]
  checkpoints: CheckpointManifest[]
  deps: HistoryDeps
  signer: () => ChallengeSigner | null
  working: () => Promise<PackedWorkingView>
}

export async function loadHistoryContext(identity: EthagentIdentity, deps: HistoryDeps): Promise<HistoryContext> {
  const ledger = (await deps.listLedger(identity))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const checkpoints = await listCheckpoints(identity)
  let signer: ChallengeSigner | null | undefined
  let working: Promise<PackedWorkingView> | undefined
  return {
    identity,
    ledger,
    checkpoints,
    deps,
    signer: () => {
      if (signer !== undefined) return signer
      const key = deps.operatorKey ?? readOperatorKey(deps.env)
      if (!key.ok && key.reason === 'invalid') {
        throw new HistoryError(2, 'ETHAGENT_OPERATOR_KEY is not a valid secp256k1 private key.')
      }
      signer = key.ok ? localKeySigner(key.key) : null
      return signer
    },
    working: () => (working ??= readWorkingView(identity)),
  }
}

export async function readWorkingView(identity: EthagentIdentity): Promise<PackedWorkingView> {
  const targets = await detectSyncTargets().catch(() => [])
  const plan = targets.length > 0 ? await planSoulMemoryReconcile(identity, targets).catch(() => null) : null
  const soulMemory = plan?.write
    ? {
        files: {
          'SOUL.md': ensureTrailingNewline(plan.write['SOUL.md']),
          'MEMORY.md': ensureTrailingNewline(plan.write['MEMORY.md']),
        },
        pulled: plan.pulled,
      }
    : undefined
  return readPackedWorkingView(identity, soulMemory)
}

function parseAt(value: string): number {
  const trimmed = value.trim()
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T23:59:59.999Z`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new HistoryError(2, `cannot read the date in at:${value}`, 'use at:YYYY-MM-DD or at:YYYY-MM-DDTHH:MM (UTC)')
  return ms
}

export function resolveRef(input: string, ctx: Pick<HistoryContext, 'identity' | 'ledger' | 'checkpoints'>): ResolvedRef {
  const ref = input.trim()
  if (!ref) throw new HistoryError(2, 'empty snapshot ref')
  const snapshotAt = (index: number, label: string): ResolvedRef => {
    const entry = ctx.ledger[index]
    if (!entry) throw new HistoryError(1, `no snapshot at ${label}: the ledger has ${ctx.ledger.length}`)
    return { kind: 'snapshot', label, cid: entry.cid, createdAt: entry.createdAt, index, entry }
  }
  if (ref === 'working') return { kind: 'working', label: 'working' }
  const latest = /^latest(?:~(\d+))?$/.exec(ref)
  if (latest) return snapshotAt(Number.parseInt(latest[1] ?? '0', 10), ref)
  if (ref === 'current') {
    const cid = ctx.identity.backup?.cid
    const index = cid ? ctx.ledger.findIndex(entry => entry.cid === cid) : -1
    if (index < 0) throw new HistoryError(1, 'this agent has no current snapshot recorded locally')
    return snapshotAt(index, ref)
  }
  if (ref.startsWith('at:')) {
    const limit = parseAt(ref.slice(3))
    const index = ctx.ledger.findIndex(entry => Date.parse(entry.createdAt) <= limit)
    if (index < 0) throw new HistoryError(1, `no snapshot at or before ${ref.slice(3)}`)
    return snapshotAt(index, ref)
  }
  if (ref.startsWith('cp:') || ref.startsWith('cp-')) {
    const id = ref.startsWith('cp:') ? ref.slice(3) : ref
    if (id === 'latest') {
      const checkpoint = ctx.checkpoints[0]
      if (!checkpoint) throw new HistoryError(1, 'no checkpoints yet')
      return { kind: 'checkpoint', label: `cp:${checkpoint.id}`, checkpoint }
    }
    const matches = ctx.checkpoints.filter(cp => cp.id.toLowerCase().startsWith(id.toLowerCase()))
    if (matches.length === 0) throw new HistoryError(1, `no checkpoint matches ${ref}`)
    if (matches.length > 1) {
      throw new HistoryError(2, `${ref} matches ${matches.length} checkpoints`, `candidates: ${matches.slice(0, 5).map(cp => cp.id).join(', ')}`)
    }
    return { kind: 'checkpoint', label: `cp:${matches[0]!.id}`, checkpoint: matches[0]! }
  }
  const exact = ctx.ledger.findIndex(entry => entry.cid === ref)
  if (exact >= 0) return snapshotAt(exact, ref)
  if (ref.length < 6) throw new HistoryError(2, `${ref} is too short to identify a snapshot`, 'use at least 6 characters of the CID, or latest, latest~N, at:DATE, cp:ID, working')
  const prefixed = ctx.ledger
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.cid.startsWith(ref))
  if (prefixed.length === 1) return snapshotAt(prefixed[0]!.index, ref)
  if (prefixed.length > 1) {
    throw new HistoryError(2, `${ref} matches ${prefixed.length} snapshots`, `candidates: ${prefixed.slice(0, 5).map(({ entry }) => entry.cid).join(', ')}`)
  }
  throw new HistoryError(1, `unknown snapshot ref: ${ref}`, 'refs: working, latest, latest~N, current, at:YYYY-MM-DD, cp:ID, cp:latest, or a CID (prefix)')
}

export function refJson(ref: ResolvedRef): Record<string, unknown> {
  if (ref.kind === 'working') return { ref: 'working', kind: 'working' }
  if (ref.kind === 'checkpoint') {
    return {
      ref: ref.label,
      kind: 'checkpoint',
      id: ref.checkpoint.id,
      createdAt: ref.checkpoint.createdAt,
      reason: ref.checkpoint.reason,
      ...(ref.checkpoint.label ? { label: ref.checkpoint.label } : {}),
    }
  }
  return {
    ref: ref.label,
    kind: 'snapshot',
    cid: ref.cid,
    createdAt: ref.createdAt,
    ledgerRef: ref.index === 0 ? 'latest' : `latest~${ref.index}`,
    ...(ref.entry.txHash ? { txHash: ref.entry.txHash } : {}),
  }
}

export type LoadedTree = { files: Record<string, Uint8Array>; forgotten: string[] }

export function notCachedHint(cid: string): string {
  return `fetch it first: \`ethagent fetch ${cid}\` with ETHAGENT_OPERATOR_KEY injected (for example via the keychain's operator-fetch), or \`ethagent fetch ${cid} --wallet\` to sign with the owner wallet in the browser`
}

export async function ensureSnapshotCached(ctx: HistoryContext, ref: Extract<ResolvedRef, { kind: 'snapshot' }>): Promise<void> {
  const manifest = await readSnapshotManifest(ctx.identity, ref.cid)
  if (manifest?.kind === 'snapshot') return
  if (manifest?.kind === 'locked') {
    throw new HistoryError(3, `snapshot ${ref.cid} could not be opened with the available keys (${manifest.reason})`, notCachedHint(ref.cid))
  }
  const signer = ctx.signer()
  if (!signer) throw new HistoryError(3, `snapshot ${ref.cid} is not cached locally`, notCachedHint(ref.cid))
  const outcome = await fetchSnapshotIntoStore(ctx.identity, ref.entry, {
    apiUrl: ctx.identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    signer,
    ...(ctx.deps.fetchImpl ? { fetchImpl: ctx.deps.fetchImpl } : {}),
  })
  if (outcome.status === 'cached' || outcome.status === 'already-cached') return
  throw new HistoryError(
    3,
    `snapshot ${ref.cid} could not be fetched (${outcome.reason ?? outcome.error ?? outcome.status})`,
    notCachedHint(ref.cid),
  )
}

export async function loadTree(ctx: HistoryContext, ref: ResolvedRef): Promise<LoadedTree> {
  if (ref.kind === 'working') {
    const view = await ctx.working()
    const files: Record<string, Uint8Array> = {}
    for (const [key, value] of Object.entries(view.files)) files[key] = Buffer.from(value, 'utf8')
    return { files, forgotten: [] }
  }
  if (ref.kind === 'checkpoint') {
    const read = await readEntryBytes(ctx.identity, ref.checkpoint.files)
    return { files: read.files, forgotten: [...read.forgotten, ...read.missing] }
  }
  await ensureSnapshotCached(ctx, ref)
  const manifest = await readSnapshotManifest(ctx.identity, ref.cid)
  if (manifest?.kind !== 'snapshot') throw new HistoryError(3, `snapshot ${ref.cid} is not cached locally`, notCachedHint(ref.cid))
  const read = await readEntryBytes(ctx.identity, manifest.files)
  return { files: read.files, forgotten: [...read.forgotten, ...read.missing] }
}
