import { createHash } from 'node:crypto'
import type { EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityFiles } from '../envelope.js'
import { continuityVaultRef } from './paths.js'
import { exists, readContinuityFiles, statIfExists } from './files.js'
import { readPublicSkillsFile } from './scaffold.js'
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
    statIfExists(ref.publicSkillsPath),
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
  const publicSkills = await readPublicSkillsFile(identity)
  return continuitySnapshotContentHashes(privateFiles, publicSkills)
}

function continuitySnapshotContentHashes(
  privateFiles: ContinuityFiles,
  publicSkills: string,
): ContinuitySnapshotContentHashes {
  return {
    'SOUL.md': hashContinuitySnapshotContent(privateFiles['SOUL.md']),
    'MEMORY.md': hashContinuitySnapshotContent(privateFiles['MEMORY.md']),
    'skills.json': hashContinuitySnapshotContent(publicSkills),
  }
}

function equalContinuitySnapshotHashes(
  a: ContinuitySnapshotContentHashes,
  b: ContinuitySnapshotContentHashes,
): boolean {
  return a['SOUL.md'] === b['SOUL.md']
    && a['MEMORY.md'] === b['MEMORY.md']
    && a['skills.json'] === b['skills.json']
}

function hashContinuitySnapshotContent(value: string): string {
  return createHash('sha256').update(normalizeSnapshotContent(value), 'utf8').digest('hex')
}

function normalizeSnapshotContent(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}
