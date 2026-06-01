import { loadConfig, type EthagentIdentity } from '../storage/config.js'
import { readContinuityFiles, statIfExists, writeContinuityFiles } from '../identity/continuity/storage/files.js'
import { continuityVaultRef } from '../identity/continuity/storage/paths.js'
import { continuityWorkingTreeStatus } from '../identity/continuity/storage/status.js'
import { listPublishedContinuitySnapshots } from '../identity/continuity/snapshots.js'
import { changedContinuitySnapshotFiles } from '../identity/manager/continuity/state.js'
import { listSkills } from '../identity/continuity/skills/loadSkills.js'
import { isDraftScaffold } from '../identity/continuity/skills/scaffold.js'
import { hashManagedBody, normalizeBody, reconstructVaultFile, sectionKey } from './syncAdapters/managedBlock.js'
import { hookFilePath, readHookPayload, samePath } from './hookIo.js'
import {
  BUILT_IN_ADAPTERS,
  type SyncAdapter,
  type SyncContext,
} from './syncAdapters/index.js'
import type { PublicSkill } from './syncAdapters/shared.js'

export type SyncOptions = { quiet?: boolean }

/**
 * Skills mirrored into local harnesses: every real skill (public AND private),
 * so private skills are usable locally. The public Agent Card stays public-only
 * (built separately via derivePublicSkillEntries). Drafts/scaffolds are skipped.
 */
export function selectMirrorSkills(all: readonly PublicSkill[]): PublicSkill[] {
  return all.filter(s => !isDraftScaffold(s))
}

export async function runSync(opts: SyncOptions = {}): Promise<number> {
  const config = await loadConfig()
  if (!config?.identity) return 0

  let all: Awaited<ReturnType<typeof listSkills>>
  try {
    all = await listSkills(config.identity)
  } catch (err) {
    process.stderr.write(`ethagent: could not load skills, skipping sync to avoid removing managed files (${(err as Error).message})\n`)
    return 1
  }
  const mirrorSkills: PublicSkill[] = selectMirrorSkills(all)

  const targets: SyncAdapter[] = []
  for (const adapter of BUILT_IN_ADAPTERS) {
    if (await adapter.detect().catch(() => false)) targets.push(adapter)
  }
  if (targets.length === 0) {
    if (!opts.quiet) process.stdout.write('ethagent: no harness detected\n')
    return 0
  }

  let context: SyncContext
  let pulled: string[] = []
  try {
    const reconciled = await reconcileSoulMemory(config.identity, targets)
    context = { soul: reconciled.soul, memory: reconciled.memory }
    pulled = reconciled.pulled
  } catch (err) {
    process.stderr.write(`ethagent: could not reconcile soul/memory, skipping sync to avoid overwriting harness files (${(err as Error).message})\n`)
    return 1
  }

  const summaries: string[] = []
  for (const adapter of targets) {
    try {
      const { count, skipped } = await adapter.mirror(mirrorSkills, context)
      let summary = `${adapter.name}: ${count} skill${count === 1 ? '' : 's'}`
      if (skipped > 0) summary += `, skipped ${skipped} unmanaged`
      summaries.push(summary)
    } catch (err) {
      summaries.push(`${adapter.name}: failed (${(err as Error).message})`)
    }
  }
  if (!opts.quiet) {
    process.stdout.write(`ethagent: synced -> ${summaries.join(' | ')}\n`)
    if (pulled.length > 0) {
      process.stdout.write(`ethagent: pulled ${pulled.join(', ')} drift from your harness into the vault\n`)
    }
  }
  if (!opts.quiet) await reportLocalChanges(config.identity)
  return 0
}

async function reportLocalChanges(identity: EthagentIdentity): Promise<void> {
  try {
    const [latest] = await listPublishedContinuitySnapshots(identity, 1)
    const status = await continuityWorkingTreeStatus(identity, latest)
    if (status.publishState !== 'local-changes') return
    const files = changedContinuitySnapshotFiles(status)
    const detail = files.length > 0 ? ` (${files.join(', ')})` : ''
    process.stdout.write(`ethagent: local changes detected${detail}, run 'ethagent' and Save Snapshot to back up\n`)
  } catch {}
}

export async function reconcileSoulMemory(
  identity: EthagentIdentity,
  adapters: SyncAdapter[],
): Promise<SyncContext & { pulled: string[] }> {
  const files = await readContinuityFiles(identity)
  const ref = continuityVaultRef(identity)
  const [soulStat, memoryStat] = await Promise.all([
    statIfExists(ref.soulPath),
    statIfExists(ref.memoryPath),
  ])

  const reads = await Promise.all(
    adapters.map(adapter => (adapter.readManaged ? adapter.readManaged().catch(() => null) : Promise.resolve(null))),
  )

  const soulPick = soulStat
    ? pickNewest(files['SOUL.md'], soulStat.mtimeMs, reads.map(r => ({ body: r?.soul ?? null, mtimeMs: r?.mtimeMs ?? 0, lastPushedHash: r?.lastSoulHash })), '# SOUL.md')
    : { content: files['SOUL.md'], pulled: false }
  const memoryPick = memoryStat
    ? pickNewest(files['MEMORY.md'], memoryStat.mtimeMs, reads.map(r => ({ body: r?.memory ?? null, mtimeMs: r?.mtimeMs ?? 0, lastPushedHash: r?.lastMemoryHash })), '# MEMORY.md')
    : { content: files['MEMORY.md'], pulled: false }

  const pulled: string[] = []
  if (soulPick.pulled) pulled.push('SOUL.md')
  if (memoryPick.pulled) pulled.push('MEMORY.md')
  if (pulled.length > 0) {
    await writeContinuityFiles(identity, { 'SOUL.md': soulPick.content, 'MEMORY.md': memoryPick.content })
  }
  return { soul: soulPick.content, memory: memoryPick.content, pulled }
}

function pickNewest(
  vaultContent: string,
  vaultMtimeMs: number,
  candidates: Array<{ body: string | null; mtimeMs: number; lastPushedHash?: string }>,
  fallbackHeader: string,
): { content: string; pulled: boolean } {
  const vaultKey = sectionKey(vaultContent)
  let winningBody: string | null = null
  let winningMtime = vaultMtimeMs
  for (const candidate of candidates) {
    if (candidate.body === null) continue
    if (normalizeBody(candidate.body) === vaultKey) continue
    if (candidate.lastPushedHash && hashManagedBody(candidate.body) === candidate.lastPushedHash) continue
    if (candidate.mtimeMs > winningMtime) {
      winningMtime = candidate.mtimeMs
      winningBody = candidate.body
    }
  }
  if (winningBody === null) return { content: vaultContent, pulled: false }
  return { content: reconstructVaultFile(vaultContent, winningBody, fallbackHeader), pulled: true }
}

export async function runSyncList(): Promise<number> {
  for (const adapter of BUILT_IN_ADAPTERS) {
    const detected = await adapter.detect().catch(() => false)
    const mark = detected ? 'detected' : 'not detected'
    process.stdout.write(`  ${adapter.name.padEnd(14)} ${mark.padEnd(13)} ${adapter.description}\n`)
  }
  return 0
}

export async function runSyncOnEdit(): Promise<number> {
  const editedPath = await readEditedFilePathFromStdin()
  if (!editedPath) return 0
  const config = await loadConfig()
  if (!config?.identity) return 0
  if (!isManagedCorePath(config.identity, editedPath)) return 0
  return runSync({ quiet: true })
}

export function isManagedCorePath(identity: EthagentIdentity, editedPath: string): boolean {
  const managed: string[] = []
  for (const adapter of BUILT_IN_ADAPTERS) {
    if (adapter.managedFilePaths) managed.push(...adapter.managedFilePaths())
  }
  const ref = continuityVaultRef(identity)
  managed.push(ref.soulPath, ref.memoryPath)
  return managed.some(candidate => samePath(candidate, editedPath))
}

async function readEditedFilePathFromStdin(): Promise<string | null> {
  return hookFilePath(await readHookPayload())
}
