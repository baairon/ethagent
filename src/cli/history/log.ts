import { readEntryBytes, readSnapshotManifest, type LockedManifest, type SnapshotManifest } from '../../identity/continuity/snapshotStore.js'
import { diffTrees, pathMatches, type TreeDiff } from '../../identity/continuity/diff/treeDiff.js'
import { renderSectionChanges } from '../../identity/continuity/diff/markdownDiff.js'
import type { PublishedContinuitySnapshot } from '../../identity/continuity/snapshots.js'
import { loadHistoryContext, type HistoryContext } from './refs.js'
import {
  emitJson,
  failFrom,
  HistoryError,
  numberValue,
  parseHistoryArgs,
  requireIdentity,
  shortCid,
  shortTime,
  stringValues,
  type HistoryDeps,
} from './shared.js'

export const HISTORY_USAGE = 'ethagent history [--limit N] [--since DATE] [--file PATH]... [--stat] [--sections] [--json]'

const COARSE_KEYS = { 'SOUL.md': 'SOUL.md', 'MEMORY.md': 'MEMORY.md', 'agent-card.json': 'agent-card.json' } as const

type Entry =
  | { kind: 'snapshot'; createdAt: string; index: number; snapshot: PublishedContinuitySnapshot }
  | { kind: 'checkpoint'; createdAt: string; checkpoint: HistoryContext['checkpoints'][number] }

export async function runHistoryLog(args: string[], deps: HistoryDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values } = parseHistoryArgs(args, {
      limit: { type: 'string' },
      since: { type: 'string' },
      file: { type: 'string', multiple: true },
      stat: { type: 'boolean' },
      sections: { type: 'boolean' },
    }, HISTORY_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${HISTORY_USAGE}\nlists published snapshots and local checkpoints, newest first. --stat and --sections compare each snapshot with the one before it (both must be cached); --file keeps only snapshots where that path changed.\n`)
      return 0
    }
    const limit = numberValue(values.limit, 'limit', 30)
    const filters = stringValues(values.file)
    const since = typeof values.since === 'string' ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(values.since) ? `${values.since}T00:00:00Z` : values.since) : null
    if (since !== null && Number.isNaN(since)) throw new HistoryError(2, `cannot read --since ${String(values.since)}`)
    const { identity } = await requireIdentity(deps)
    const ctx = await loadHistoryContext(identity, deps)
    const manifests = new Map<string, SnapshotManifest | LockedManifest | null>()
    const manifestFor = async (cid: string): Promise<SnapshotManifest | LockedManifest | null> => {
      if (!manifests.has(cid)) manifests.set(cid, await readSnapshotManifest(identity, cid))
      return manifests.get(cid) ?? null
    }
    const diffWithPrevious = async (index: number, withLines: boolean, withSections: boolean): Promise<TreeDiff | 'uncached' | null> => {
      const newer = ctx.ledger[index]!
      const older = ctx.ledger[index + 1]
      if (!older) return null
      const a = await manifestFor(older.cid)
      const b = await manifestFor(newer.cid)
      if (a?.kind !== 'snapshot' || b?.kind !== 'snapshot') return 'uncached'
      const left = await readEntryBytes(identity, a.files)
      const right = await readEntryBytes(identity, b.files)
      return diffTrees(left.files, right.files, {
        lines: withLines,
        semantic: withSections,
        include: path => pathMatches(path, filters),
      })
    }
    const changedPaths = async (index: number): Promise<{ changed: boolean | null; exact: boolean }> => {
      const newer = ctx.ledger[index]!
      const older = ctx.ledger[index + 1]
      if (!older) return { changed: true, exact: true }
      const a = await manifestFor(older.cid)
      const b = await manifestFor(newer.cid)
      if (a?.kind === 'snapshot' && b?.kind === 'snapshot') {
        const paths = new Set([...Object.keys(a.files), ...Object.keys(b.files)])
        const changed = [...paths].some(path => pathMatches(path, filters) && a.files[path]?.sha256 !== b.files[path]?.sha256)
        return { changed, exact: true }
      }
      const coarse = Object.keys(COARSE_KEYS).filter(key => pathMatches(key, filters)) as Array<keyof typeof COARSE_KEYS>
      if (coarse.length === 0 || !newer.contentHashes || !older.contentHashes) return { changed: null, exact: false }
      return { changed: coarse.some(key => newer.contentHashes![key] !== older.contentHashes![key]), exact: false }
    }
    let entries: Entry[] = [
      ...ctx.ledger.map((snapshot, index) => ({ kind: 'snapshot' as const, createdAt: snapshot.createdAt, index, snapshot })),
      ...ctx.checkpoints.map(checkpoint => ({ kind: 'checkpoint' as const, createdAt: checkpoint.createdAt, checkpoint })),
    ].sort((x, y) => y.createdAt.localeCompare(x.createdAt))
    if (since !== null) entries = entries.filter(entry => Date.parse(entry.createdAt) >= since)
    if (filters.length > 0) {
      const kept: Entry[] = []
      for (const entry of entries) {
        if (entry.kind === 'checkpoint') continue
        const { changed } = await changedPaths(entry.index)
        if (changed) kept.push(entry)
      }
      entries = kept
    }
    if (limit > 0) entries = entries.slice(0, limit)
    const rows: Array<Record<string, unknown>> = []
    const textRows: string[] = []
    for (const entry of entries) {
      if (entry.kind === 'checkpoint') {
        const cp = entry.checkpoint
        rows.push({
          ref: `cp:${cp.id}`,
          kind: 'checkpoint',
          id: cp.id,
          createdAt: cp.createdAt,
          reason: cp.reason,
          ...(cp.label ? { label: cp.label } : {}),
          ...(cp.target ? { target: cp.target } : {}),
          files: Object.keys(cp.files).length,
        })
        textRows.push(`cp:${cp.id}  ${shortTime(cp.createdAt)}  checkpoint (${cp.reason})${cp.label ? `  ${cp.label}` : ''}`)
        continue
      }
      const snapshot = entry.snapshot
      const manifest = await manifestFor(snapshot.cid)
      const cache = manifest?.kind === 'snapshot' ? 'cached' : manifest?.kind === 'locked' ? `locked:${manifest.reason}` : 'none'
      const ref = entry.index === 0 ? 'latest' : `latest~${entry.index}`
      const row: Record<string, unknown> = {
        ref,
        kind: 'snapshot',
        cid: snapshot.cid,
        createdAt: snapshot.createdAt,
        label: snapshot.label,
        txHash: snapshot.txHash ?? null,
        current: snapshot.cid === identity.backup?.cid,
        cache,
      }
      textRows.push(`${ref.padEnd(10)} ${shortTime(snapshot.createdAt)}  ${shortCid(snapshot.cid)}  ${cache}${row.current ? '  (current)' : ''}`)
      if (values.stat || values.sections) {
        const diff = await diffWithPrevious(entry.index, Boolean(values.stat), Boolean(values.sections))
        if (diff === 'uncached') {
          row.changes = null
          row.changesNote = 'this snapshot or the one before it is not cached'
          textRows.push('    (not cached, run fetch to compare)')
        } else if (diff) {
          row.changes = diff.files.map(file => ({
            path: file.path,
            change: file.change,
            added: file.added,
            removed: file.removed,
            ...(file.eolOnly ? { eolOnly: true } : {}),
            ...(values.sections && file.sections ? { sections: file.sections } : {}),
            ...(values.sections && file.json ? { json: file.json } : {}),
          }))
          for (const file of diff.files) {
            const mark = file.change === 'added' ? 'A' : file.change === 'removed' ? 'D' : 'M'
            textRows.push(`    ${mark} ${file.path}  +${file.added} -${file.removed}`)
            if (values.sections && file.sections) textRows.push(renderSectionChanges(file.sections).replace(/\n$/, '').replace(/^/gm, '    '))
          }
        }
      }
      rows.push(row)
    }
    if (json) {
      await emitJson(deps.io, { entries: rows, total: { snapshots: ctx.ledger.length, checkpoints: ctx.checkpoints.length } })
    } else {
      await deps.io.out(rows.length ? `${textRows.join('\n')}\n` : 'no history entries match\n')
    }
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
