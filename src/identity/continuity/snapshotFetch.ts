import type { EthagentIdentity } from '../../storage/config.js'
import { catFromIpfs, type FetchLike } from '../storage/ipfs.js'
import { isContinuitySnapshotEnvelope, parseRestorableEnvelope } from '../manager/restore/envelopes.js'
import { decryptWithSigner, type ChallengeSigner } from './localKeyDecrypt.js'
import type { PublishedContinuitySnapshot } from './snapshots.js'
import { putLocked, putSnapshot, readSnapshotManifest, type LockReason } from './snapshotStore.js'

export type FetchStatus = 'cached' | 'already-cached' | 'locked' | 'needs-key' | 'skipped' | 'error'

export type FetchOutcome = {
  cid: string
  status: FetchStatus
  reason?: LockReason
  slots?: string[]
  error?: string
}

export type FetchDeps = {
  apiUrl: string
  fetchImpl?: FetchLike
  signer?: ChallengeSigner
  lockWaitMs?: number
}

export async function fetchSnapshotIntoStore(
  identity: EthagentIdentity,
  entry: Pick<PublishedContinuitySnapshot, 'cid' | 'agentCardCid' | 'createdAt'>,
  deps: FetchDeps,
  opts: { retryLocked?: boolean } = {},
): Promise<FetchOutcome> {
  const cid = entry.cid
  const existing = await readSnapshotManifest(identity, cid)
  if (existing?.kind === 'snapshot') return { cid, status: 'already-cached' }
  if (existing?.kind === 'locked' && !opts.retryLocked) {
    return { cid, status: 'locked', reason: existing.reason, ...(existing.slots ? { slots: existing.slots } : {}) }
  }
  const fetchImpl = deps.fetchImpl ?? fetch
  const lock = { waitMs: deps.lockWaitMs ?? 5000 }
  const storeError = (err: unknown): FetchOutcome => ({ cid, status: 'error', error: err instanceof Error ? err.message : String(err) })
  let envelope: ReturnType<typeof parseRestorableEnvelope>
  try {
    const raw = await catFromIpfs(deps.apiUrl, cid, fetchImpl)
    envelope = parseRestorableEnvelope(raw)
  } catch (err) {
    return { cid, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
  if (!isContinuitySnapshotEnvelope(envelope)) {
    try {
      await putLocked(identity, cid, { reason: 'state-only' }, lock)
    } catch (err) {
      return storeError(err)
    }
    return { cid, status: 'locked', reason: 'state-only' }
  }
  if (!deps.signer) return { cid, status: 'needs-key' }
  let decrypted: Awaited<ReturnType<typeof decryptWithSigner>>
  try {
    decrypted = await decryptWithSigner(envelope, deps.signer)
  } catch (err) {
    return { cid, status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
  if (!decrypted.ok) {
    try {
      await putLocked(identity, cid, {
        reason: decrypted.reason,
        keyAddress: deps.signer.address,
        ...(decrypted.slots ? { slots: decrypted.slots } : {}),
      }, lock)
    } catch (err) {
      return storeError(err)
    }
    return { cid, status: 'locked', reason: decrypted.reason, ...(decrypted.slots ? { slots: decrypted.slots } : {}) }
  }
  let agentCard: string | undefined
  if (entry.agentCardCid) {
    try {
      const bytes = await catFromIpfs(deps.apiUrl, entry.agentCardCid, fetchImpl)
      agentCard = Buffer.from(bytes).toString('utf8')
    } catch {
      agentCard = undefined
    }
  }
  try {
    await putSnapshot(identity, cid, {
      privateFiles: decrypted.payload.files,
      ...(agentCard !== undefined ? { agentCard } : {}),
      ...(decrypted.payload.skills ? { skills: decrypted.payload.skills } : {}),
    }, { source: 'fetch', createdAt: envelope.createdAt, ...(entry.agentCardCid ? { agentCardCid: entry.agentCardCid } : {}) }, lock)
  } catch (err) {
    return storeError(err)
  }
  return { cid, status: 'cached' }
}
