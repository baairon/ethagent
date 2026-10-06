import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText } from '../../storage/atomicWrite.js'
import { decodeText, sha256Bytes } from '../../identity/continuity/diff/treeDiff.js'
import { loadHistoryContext, loadTree, refJson, resolveRef } from './refs.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from './shared.js'

export const SHOW_USAGE = 'ethagent show <ref> [--file PATH] [--out FILE] [--json]'

export function findTreePath(files: Record<string, Uint8Array>, requested: string): string {
  const normalized = requested.replace(/\\/g, '/').replace(/^\.\//, '')
  if (files[normalized]) return normalized
  const insensitive = Object.keys(files).filter(key => key.toLowerCase() === normalized.toLowerCase())
  if (insensitive.length === 1) return insensitive[0]!
  if (files[`skills/${normalized}`]) return `skills/${normalized}`
  throw new HistoryError(1, `${requested} is not in this snapshot`, 'run `ethagent show <ref>` without --file to list its paths')
}

export async function runShowCommand(args: string[], deps: HistoryDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, { file: { type: 'string' }, out: { type: 'string' } }, SHOW_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${SHOW_USAGE}\nwithout --file, lists every path in the snapshot with its sha256 and size. with --file, prints that file's exact bytes (or writes them to --out).\n`)
      return 0
    }
    if (positionals.length !== 1) throw new HistoryError(2, 'show needs exactly one ref', `usage: ${SHOW_USAGE}`)
    const { identity } = await requireIdentity(deps)
    const ctx = await loadHistoryContext(identity, deps)
    const ref = resolveRef(positionals[0]!, ctx)
    const tree = await loadTree(ctx, ref)
    if (typeof values.file !== 'string') {
      const files = Object.keys(tree.files).sort().map(key => {
        const bytes = tree.files[key]!
        return { path: key, sha256: sha256Bytes(bytes), size: bytes.length, ...(decodeText(bytes) === null ? { binary: true } : {}) }
      })
      if (json) await emitJson(deps.io, { ...refJson(ref), files, forgotten: tree.forgotten })
      else {
        const lines = files.map(file => `${file.sha256.slice(0, 12)}  ${String(file.size).padStart(8)}  ${file.path}`)
        for (const forgotten of tree.forgotten) lines.push(`(forgotten)            ${forgotten}`)
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }
    const wanted = values.file.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    if (tree.forgotten.some(key => key.toLowerCase() === wanted || key.toLowerCase() === `skills/${wanted}`)) {
      throw new HistoryError(1, `${values.file} was forgotten from local history`)
    }
    const key = findTreePath(tree.files, values.file)
    const bytes = tree.files[key]!
    if (typeof values.out === 'string') {
      const target = path.resolve(values.out)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await atomicWriteText(target, bytes, { mode: 0o600 })
      if (json) await emitJson(deps.io, { ...refJson(ref), path: key, sha256: sha256Bytes(bytes), size: bytes.length, out: target })
      else await deps.io.err(`wrote ${bytes.length} bytes of ${key} to ${target}\n`)
      return 0
    }
    if (json) {
      const text = decodeText(bytes)
      await emitJson(deps.io, {
        ...refJson(ref),
        path: key,
        sha256: sha256Bytes(bytes),
        size: bytes.length,
        encoding: text === null ? 'base64' : 'utf8',
        content: text ?? Buffer.from(bytes).toString('base64'),
      })
    } else {
      await deps.io.out(bytes)
    }
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
