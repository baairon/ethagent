import { getAddress } from 'viem'
import { continuityPublishState, continuitySnapshotContentHashesFromSources } from '../../identity/continuity/storage/status.js'
import type { ContinuitySnapshotContentHashes } from '../../identity/continuity/storage/types.js'
import { listSnapshotManifests, readSnapshotManifest, snapshotStoreDir } from '../../identity/continuity/snapshotStore.js'
import { exactLocalChanges } from '../../identity/continuity/localChanges.js'
import { continuityVaultRef } from '../../identity/continuity/storage/paths.js'
import { hasPendingPublish } from '../../identity/manager/continuity/state.js'
import { resolveRegistryForIdentity } from '../../identity/registry/registryConfig.js'
import { discoverOwnedAgentBackupByTokenId } from '../../identity/registry/erc8004/discovery.js'
import { DEFAULT_IPFS_API_URL } from '../../identity/storage/ipfs.js'
import { daemonStatus, isPaused } from '../daemon.js'
import { loadHistoryContext } from './refs.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, shortCid, shortTime, type HistoryDeps } from './shared.js'

export const STATUS_USAGE = 'ethagent status [--verify] [--json]'

type Change = { path: string; change: 'added' | 'removed' | 'modified'; added?: number; removed?: number; eolOnly?: true; trailingNewlineOnly?: true }

const COARSE_PATHS: Array<[keyof ContinuitySnapshotContentHashes, string]> = [
  ['SOUL.md', 'SOUL.md'],
  ['MEMORY.md', 'MEMORY.md'],
  ['agent-card.json', 'agent-card.json'],
  ['private-skills', 'skills/'],
]

export async function runStatusCommand(args: string[], deps: HistoryDeps, discover = discoverOwnedAgentBackupByTokenId): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values } = parseHistoryArgs(args, { verify: { type: 'boolean' } }, STATUS_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${STATUS_USAGE}\nshows publish state, what changed since the latest snapshot (per file and per skill), and what a save would leave out. --verify also checks the onchain pointer.\n`)
      return 0
    }
    const { config, identity } = await requireIdentity(deps)
    const ctx = await loadHistoryContext(identity, deps)
    const view = await ctx.working()
    const latest = ctx.ledger[0]
    const localHashes = continuitySnapshotContentHashesFromSources({
      privateFiles: view.sources.privateFiles,
      agentCard: view.sources.agentCard,
      skills: view.sources.skills,
    })
    const publishState = continuityPublishState({
      ready: view.ready,
      hasBackup: Boolean(identity.backup?.cid),
      local: localHashes,
      ...(latest?.contentHashes ? { published: latest.contentHashes } : {}),
    })
    const exactChanges = await exactLocalChanges(identity, latest?.cid, view)
    const exact = exactChanges !== null
    let changes: Change[] = []
    if (exactChanges) {
      changes = exactChanges.files
    } else if (latest?.contentHashes) {
      changes = COARSE_PATHS
        .filter(([key]) => (localHashes[key] ?? '') !== (latest.contentHashes?.[key] ?? ''))
        .map(([, path]) => ({ path, change: 'modified' as const }))
    }
    const manifests = await listSnapshotManifests(identity)
    const cache = {
      cached: manifests.filter(item => item.kind === 'snapshot').length,
      locked: manifests.filter(item => item.kind === 'locked').length,
      ledger: ctx.ledger.length,
      checkpoints: ctx.checkpoints.length,
    }
    const daemon = { ...daemonStatus(), paused: isPaused() }
    let verify: Record<string, unknown> | undefined
    let inconsistent = false
    if (values.verify) {
      const registry = resolveRegistryForIdentity(identity, config)
      if (!registry || !identity.agentId) throw new HistoryError(1, 'no registry or agent token id is configured for this identity')
      const candidate = await discover({
        ...registry,
        ownerHandle: getAddress(identity.ownerAddress ?? identity.address),
        tokenId: BigInt(identity.agentId),
        ipfsApiUrl: identity.backup?.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
      })
      const onchainCid = candidate.backup?.cid ?? null
      const issues: string[] = []
      if (!onchainCid) issues.push('the onchain pointer has no snapshot')
      if (onchainCid && latest && onchainCid !== latest.cid) issues.push('the onchain snapshot is not the newest one in the local ledger')
      if (onchainCid && identity.backup?.cid && onchainCid !== identity.backup.cid) issues.push('the onchain snapshot differs from the one this machine last saved or restored')
      if (hasPendingPublish(identity)) issues.push('a pinned snapshot is waiting for the owner to publish it')
      inconsistent = issues.length > 0
      verify = {
        onchainCid,
        agentUri: candidate.agentUri ?? null,
        agentCardCid: candidate.publicDiscovery?.agentCardCid ?? null,
        onchainCached: onchainCid ? (await readSnapshotManifest(identity, onchainCid))?.kind === 'snapshot' : false,
        issues,
      }
    }
    const result = {
      agentId: identity.agentId ?? null,
      chainId: identity.chainId ?? null,
      vault: continuityVaultRef(identity).dir,
      store: snapshotStoreDir(identity),
      publishState,
      pendingPublish: hasPendingPublish(identity),
      baseline: latest
        ? { cid: latest.cid, createdAt: latest.createdAt, txHash: latest.txHash ?? null, cached: exact, exact }
        : null,
      changes,
      pendingPull: view.pendingPull,
      skipped: view.skipped,
      lossy: view.lossy,
      normalizesOnSave: view.normalizesOnSave,
      warnings: view.warnings,
      cache,
      daemon,
      ...(verify ? { verify } : {}),
    }
    if (json) {
      await emitJson(deps.io, result)
    } else {
      const out: string[] = []
      out.push(`agent #${identity.agentId ?? '?'} · vault ${result.vault}`)
      out.push(`publish state: ${publishState}${result.pendingPublish ? ' (pinned snapshot waiting for the owner to publish)' : ''}`)
      if (latest) out.push(`latest snapshot: ${shortTime(latest.createdAt)} ${shortCid(latest.cid)}${latest.txHash ? ` tx ${latest.txHash.slice(0, 10)}...` : ''}${exact ? '' : ' (not cached locally, comparison is coarse)'}`)
      if (changes.length === 0) out.push('changes since latest: none')
      else {
        out.push(`changes since latest${exact ? '' : ' (coarse)'}:`)
        for (const change of changes) {
          const mark = change.change === 'added' ? 'A' : change.change === 'removed' ? 'D' : 'M'
          const counts = change.added !== undefined ? `  +${change.added} -${change.removed}` : ''
          const note = change.eolOnly ? '  (line endings only)' : change.trailingNewlineOnly ? '  (trailing newline only)' : ''
          out.push(`  ${mark} ${change.path}${counts}${note}`)
        }
      }
      if (view.pendingPull.length > 0) out.push(`pending pull from harness: ${view.pendingPull.join(', ')}`)
      for (const skip of view.skipped) out.push(`not backed up: ${skip.path} (${skip.reason})`)
      if (view.lossy.length > 0) out.push(`not valid UTF-8, packed lossy: ${view.lossy.join(', ')}`)
      for (const warning of view.warnings) out.push(`warning: ${warning}`)
      out.push(`history: ${cache.cached} of ${cache.ledger} snapshots cached${cache.locked ? `, ${cache.locked} locked` : ''}, ${cache.checkpoints} checkpoint${cache.checkpoints === 1 ? '' : 's'}`)
      out.push(`sync daemon: ${daemon.paused ? 'paused' : daemon.running ? `running (pid ${daemon.pid})` : 'not running'}`)
      if (verify) {
        out.push(`onchain snapshot: ${verify.onchainCid ? shortCid(String(verify.onchainCid)) : 'none'}`)
        for (const issue of verify.issues as string[]) out.push(`  issue: ${issue}`)
        if ((verify.issues as string[]).length === 0) out.push('  onchain pointer, ledger, and local state agree')
      }
      await deps.io.out(`${out.join('\n')}\n`)
    }
    return inconsistent ? 4 : 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
