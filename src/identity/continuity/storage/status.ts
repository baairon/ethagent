import { createHash } from 'node:crypto'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles, ContinuitySkillsTree } from '../envelope.js'
import { loadSkillsTree } from '../skills/loadSkills.js'
import { syncAgentCardManifest } from '../skills/publicSkillsSync.js'
import { continuityVaultRef } from './paths.js'
import { exists, readContinuityFiles, statIfExists } from './files.js'
import { readAgentCardFile } from './scaffold.js'
import type { ContinuityPublishState, ContinuitySnapshotContentHashes, ContinuityVaultRef, ContinuityWorkingTreeStatus } from './types.js'

export async function continuityVaultStatus(identity: EthagentIdentity): Promise<{ ready: boolean; files: ContinuityVaultRef }> {
  const ref = continuityVaultRef(identity)
  const [soul, memory] = await Promise.all([exists(ref.soulPath), exists(ref.memoryPath)])
  return { ready: soul && memory, files: ref }
}

export async function continuityWorkingTreeStatus(
  identity: EthagentIdentity,
  publishedSnapshot?: { contentHashes?: ContinuitySnapshotContentHashes },
): Promise<ContinuityWorkingTreeStatus> {
  const ref = continuityVaultRef(identity)
  const stats = await Promise.all([
    statIfExists(ref.soulPath),
    statIfExists(ref.memoryPath),
    statIfExists(ref.agentCardPath),
  ])
  const newestMs = Math.max(0, ...stats.flatMap(stat => stat ? [stat.mtimeMs] : []))
  const ready = Boolean(stats[0] && stats[1])
  const localContentHashes = ready
    ? await localContinuitySnapshotContentHashes(identity).catch(() => undefined)
    : undefined
  const publishedContentHashes = publishedSnapshot?.contentHashes
  const publishState: ContinuityPublishState = !ready
    ? 'not-restored'
    : !identity.backup?.cid
      ? 'not-published'
      : !localContentHashes || !publishedContentHashes
        ? 'verify-needed'
        : equalContinuitySnapshotHashes(localContentHashes, publishedContentHashes)
          ? 'published'
          : 'local-changes'

  return {
    ready,
    ...(newestMs > 0 ? { newestLocalChangeAt: new Date(newestMs).toISOString() } : {}),
    localChangedAfterBackup: publishState === 'local-changes',
    publishState,
    ...(localContentHashes ? { localContentHashes } : {}),
    ...(publishedContentHashes ? { publishedContentHashes } : {}),
  }
}

export async function localContinuitySnapshotContentHashes(
  identity: EthagentIdentity,
): Promise<ContinuitySnapshotContentHashes> {
  const privateFiles = await readContinuityFiles(identity)
  await syncAgentCardManifest(identity).catch(() => undefined)
  const agentCard = await readAgentCardFile(identity)
  const skills = await loadSkillsTree(identity).catch(() => ({} as ContinuitySkillsTree))
  return continuitySnapshotContentHashes(privateFiles, agentCard, skills)
}

export function continuitySnapshotContentHashesFromSources(args: {
  privateFiles: ContinuityFiles
  agentCard: string
  skills: ContinuitySkillsTree
}): ContinuitySnapshotContentHashes {
  return continuitySnapshotContentHashes(args.privateFiles, args.agentCard, args.skills)
}

function continuitySnapshotContentHashes(
  privateFiles: ContinuityFiles,
  agentCard: string,
  skills: ContinuitySkillsTree,
): ContinuitySnapshotContentHashes {
  const skillsHash = hashSkillsTree(skills)
  return {
    'SOUL.md': hashContinuitySnapshotContent(privateFiles['SOUL.md']),
    'MEMORY.md': hashContinuitySnapshotContent(privateFiles['MEMORY.md']),
    'agent-card.json': hashContinuitySnapshotContent(agentCard),
    ...(skillsHash ? { 'private-skills': skillsHash } : {}),
  }
}

export function hashSkillsTree(tree: ContinuitySkillsTree): string {
  const keys = Object.keys(tree).sort()
  if (keys.length === 0) return ''
  const h = createHash('sha256')
  for (const key of keys) {
    h.update(key, 'utf8')
    h.update('\0')
    h.update(normalizeSnapshotContent(tree[key] ?? ''), 'utf8')
    h.update('\0')
  }
  return h.digest('hex')
}

function equalContinuitySnapshotHashes(
  a: ContinuitySnapshotContentHashes,
  b: ContinuitySnapshotContentHashes,
): boolean {
  if (a['SOUL.md'] !== b['SOUL.md']) return false
  if (a['MEMORY.md'] !== b['MEMORY.md']) return false
  if (a['agent-card.json'] !== b['agent-card.json']) return false
  return a['private-skills'] === b['private-skills']
}

function hashContinuitySnapshotContent(value: string): string {
  return createHash('sha256').update(normalizeSnapshotContent(value), 'utf8').digest('hex')
}

function normalizeSnapshotContent(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}
