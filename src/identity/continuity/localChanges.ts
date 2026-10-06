import type { EthagentIdentity } from '../../storage/config.js'
import { diffTrees } from './diff/treeDiff.js'
import { readEntryBytes, readSnapshotManifest } from './snapshotStore.js'
import { readPackedWorkingView, type PackedWorkingView } from './storage/packed.js'

export type ChangeKind = 'added' | 'removed' | 'modified'

export type LocalFileChange = {
  path: string
  change: ChangeKind
  added: number
  removed: number
  eolOnly?: true
  trailingNewlineOnly?: true
}

export type LocalChanges = {
  files: LocalFileChange[]
  skills: Array<{ name: string; change: ChangeKind }>
}

export async function exactLocalChanges(
  identity: EthagentIdentity,
  latestCid: string | undefined,
  view?: PackedWorkingView,
): Promise<LocalChanges | null> {
  if (!latestCid) return null
  const manifest = await readSnapshotManifest(identity, latestCid)
  if (manifest?.kind !== 'snapshot') return null
  const base = await readEntryBytes(identity, manifest.files)
  const current = view ?? await readPackedWorkingView(identity)
  const working: Record<string, Uint8Array> = {}
  for (const [key, value] of Object.entries(current.files)) working[key] = Buffer.from(value, 'utf8')
  const diff = diffTrees(base.files, working, { lines: false, semantic: false })
  return {
    files: diff.files.map(file => ({
      path: file.path,
      change: file.change,
      added: file.added,
      removed: file.removed,
      ...(file.eolOnly ? { eolOnly: true as const } : {}),
      ...(file.trailingNewlineOnly ? { trailingNewlineOnly: true as const } : {}),
    })),
    skills: diff.skills
      .map(skill => ({ name: skill.skill, change: skill.change }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
