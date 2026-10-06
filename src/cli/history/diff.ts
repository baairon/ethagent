import { diffTrees, pathMatches } from '../../identity/continuity/diff/treeDiff.js'
import { renderUnifiedPatch } from '../../identity/continuity/diff/lineDiff.js'
import { renderSectionChanges } from '../../identity/continuity/diff/markdownDiff.js'
import { loadHistoryContext, loadTree, refJson, resolveRef, type ResolvedRef } from './refs.js'
import {
  emitJson,
  failFrom,
  HistoryError,
  numberValue,
  parseHistoryArgs,
  requireIdentity,
  stringValues,
  type HistoryDeps,
} from './shared.js'

export const DIFF_USAGE = 'ethagent diff [A] [B] [--file PATH]... [--stat] [--sections] [--context N] [--json]'

function labelOf(ref: ResolvedRef): string {
  if (ref.kind === 'snapshot') return `${ref.label} ${ref.cid.slice(0, 12)}`
  return ref.label
}

export async function runDiffCommand(args: string[], deps: HistoryDeps): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      file: { type: 'string', multiple: true },
      stat: { type: 'boolean' },
      sections: { type: 'boolean' },
      context: { type: 'string' },
    }, DIFF_USAGE)
    if (values.help) {
      await deps.io.out(`usage: ${DIFF_USAGE}\ncompares two refs byte for byte (default: latest vs working). with one ref, compares it to working. --json returns per-file hashes, line hunks, Markdown section changes, and JSON path changes.\n`)
      return 0
    }
    if (positionals.length > 2) throw new HistoryError(2, 'diff takes at most two refs', `usage: ${DIFF_USAGE}`)
    const context = numberValue(values.context, 'context', 3)
    const filters = stringValues(values.file)
    const { identity } = await requireIdentity(deps)
    const ctx = await loadHistoryContext(identity, deps)
    const a = resolveRef(positionals[0] ?? 'latest', ctx)
    const b = resolveRef(positionals[1] ?? 'working', ctx)
    const left = await loadTree(ctx, a)
    const right = await loadTree(ctx, b)
    const diff = diffTrees(left.files, right.files, {
      context,
      lines: !values.stat,
      semantic: true,
      include: path => pathMatches(path, filters),
    })
    if (json) {
      await emitJson(deps.io, {
        a: refJson(a),
        b: refJson(b),
        identical: diff.identical,
        summary: diff.summary,
        files: diff.files,
        skills: diff.skills,
        forgotten: { a: left.forgotten, b: right.forgotten },
      })
      return 0
    }
    const out: string[] = []
    const { files: count, lines } = diff.summary
    out.push(`${labelOf(a)} -> ${labelOf(b)}: ${diff.identical ? 'identical' : `${count.modified} modified, ${count.added} added, ${count.removed} removed, ${count.identical} identical; +${lines.added} -${lines.removed} lines`}`)
    if (values.stat) {
      for (const file of diff.files) {
        const mark = file.change === 'added' ? 'A' : file.change === 'removed' ? 'D' : 'M'
        const note = file.binary ? '  (binary)' : file.eolOnly ? '  (line endings only)' : file.trailingNewlineOnly ? '  (trailing newline only)' : ''
        out.push(`  ${mark} ${file.path}  +${file.added} -${file.removed}${note}`)
      }
      await deps.io.out(`${out.join('\n')}\n`)
      return 0
    }
    let body = `${out.join('\n')}\n`
    for (const file of diff.files) {
      if (values.sections) {
        const header = `${file.change === 'added' ? 'A' : file.change === 'removed' ? 'D' : 'M'} ${file.path}  +${file.added} -${file.removed}\n`
        if (file.sections) body += header + renderSectionChanges(file.sections)
        else if (file.json) body += header + file.json.map(change => `  ${change.change === 'added' ? '+' : change.change === 'removed' ? '-' : '~'} ${change.path}\n`).join('')
        else body += header
        continue
      }
      if (file.binary) {
        body += `Binary ${file.path} differs (${file.a?.sha256.slice(0, 12) ?? 'absent'} -> ${file.b?.sha256.slice(0, 12) ?? 'absent'})\n`
        continue
      }
      body += renderUnifiedPatch(
        { added: file.added, removed: file.removed, hunks: file.hunks ?? [], replaced: Boolean(file.replaced) },
        { a: file.a ? `a/${file.path}` : '/dev/null', b: file.b ? `b/${file.path}` : '/dev/null' },
      )
    }
    await deps.io.out(body)
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
