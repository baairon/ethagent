import {
  forgetCheckpoint,
  forgetContent,
  forgetEverything,
  forgetSnapshot,
  readSnapshotManifest,
  type StoreEntry,
} from '../../identity/continuity/snapshotStore.js'
import { pathMatches } from '../../identity/continuity/diff/treeDiff.js'
import { loadHistoryContext, refJson, resolveRef } from './refs.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, stringValues, type HistoryDeps } from './shared.js'

export const FORGET_USAGE = 'ethagent forget <ref> [--file PATH]... [--yes] [--json]  |  ethagent forget --all [--yes] [--json]'

const PINNED_NOTE = 'this only removes the local plaintext copy; the encrypted snapshots on IPFS are unchanged'

export async function runForgetCommand(args: string[], deps: HistoryDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      file: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      yes: { type: 'boolean' },
    }, FORGET_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${FORGET_USAGE}\nremoves local plaintext history. with --file, that exact content is erased from every snapshot and checkpoint that holds it and is never cached again (leak repair). previews by default; --yes applies.\n`)
      return 0
    }
    const { identity } = await requireIdentity(deps)
    if (values.all) {
      if (positionals.length > 0) throw new HistoryError(2, '--all takes no ref', `usage: ${FORGET_USAGE}`)
      if (!values.yes) {
        const preview = { applied: false, scope: 'all', note: PINNED_NOTE }
        if (json) await emitJson(deps.io, preview)
        else await deps.io.out(`would delete all local snapshot copies and checkpoints. rerun with --yes to apply. ${PINNED_NOTE}.\n`)
        return 0
      }
      const removed = await forgetEverything(identity)
      if (json) await emitJson(deps.io, { applied: true, scope: 'all', removed, note: PINNED_NOTE })
      else await deps.io.out(`deleted local history: ${removed.manifests} snapshots, ${removed.checkpoints} checkpoints, ${removed.objects} objects. ${PINNED_NOTE}.\n`)
      return 0
    }
    if (positionals.length !== 1) throw new HistoryError(2, 'forget needs exactly one ref (or --all)', `usage: ${FORGET_USAGE}`)
    const ctx = await loadHistoryContext(identity, deps)
    const target = resolveRef(positionals[0]!, ctx)
    if (target.kind === 'working') throw new HistoryError(2, 'the working vault cannot be forgotten; edit the file instead')
    const filters = stringValues(values.file)
    let entries: Record<string, StoreEntry> = {}
    if (target.kind === 'checkpoint') entries = target.checkpoint.files
    else {
      const manifest = await readSnapshotManifest(identity, target.cid)
      if (manifest?.kind === 'snapshot') entries = manifest.files
      else if (filters.length > 0) throw new HistoryError(1, `snapshot ${target.cid} has no local copy to forget from`)
    }
    if (filters.length > 0) {
      const picked = Object.entries(entries).filter(([key]) => pathMatches(key, filters))
      if (picked.length === 0) throw new HistoryError(1, 'none of the requested paths are in that ref')
      const shas = [...new Set(picked.map(([, entry]) => entry.sha256))]
      if (!values.yes) {
        const preview = { applied: false, target: refJson(target), paths: picked.map(([key]) => key), contents: shas.length, note: PINNED_NOTE }
        if (json) await emitJson(deps.io, preview)
        else await deps.io.out(`would erase ${shas.length} file version${shas.length === 1 ? '' : 's'} (${picked.map(([key]) => key).join(', ')}) from every snapshot and checkpoint holding them. rerun with --yes to apply.\n`)
        return 0
      }
      const removed = await forgetContent(identity, shas)
      if (json) await emitJson(deps.io, { applied: true, target: refJson(target), paths: picked.map(([key]) => key), removed, note: PINNED_NOTE })
      else await deps.io.out(`erased ${removed.objects} object${removed.objects === 1 ? '' : 's'}; marked in ${removed.manifests} snapshots and ${removed.checkpoints} checkpoints. ${PINNED_NOTE}.\n`)
      return 0
    }
    if (!values.yes) {
      const preview = { applied: false, target: refJson(target), note: PINNED_NOTE }
      if (json) await emitJson(deps.io, preview)
      else await deps.io.out(`would delete the local copy of ${target.label} (content still used by other entries is kept). rerun with --yes to apply.\n`)
      return 0
    }
    const removed = target.kind === 'checkpoint'
      ? await forgetCheckpoint(identity, target.checkpoint.id)
      : await forgetSnapshot(identity, target.cid)
    if (json) await emitJson(deps.io, { applied: true, target: refJson(target), removed, note: PINNED_NOTE })
    else await deps.io.out(`deleted the local copy of ${target.label} (${removed.objects} unreferenced objects removed). ${PINNED_NOTE}.\n`)
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
