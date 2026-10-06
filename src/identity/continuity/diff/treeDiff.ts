import { createHash } from 'node:crypto'
import { diffJson, parseJsonOrNull, type JsonChange } from './jsonDiff.js'
import { diffLines, markdownHeadingFor, type Hunk } from './lineDiff.js'
import { diffMarkdownSections, type SectionChange } from './markdownDiff.js'

export type FileSide = { sha256: string; size: number } | null

export type FileDiff = {
  path: string
  change: 'added' | 'removed' | 'modified'
  a: FileSide
  b: FileSide
  binary?: true
  eolOnly?: true
  trailingNewlineOnly?: true
  added: number
  removed: number
  replaced?: true
  hunks?: Hunk[]
  sections?: SectionChange[]
  json?: JsonChange[]
}

export type SkillChangeSummary = { skill: string; change: 'added' | 'removed' | 'modified'; files: string[] }

export type TreeDiff = {
  identical: boolean
  summary: {
    files: { added: number; removed: number; modified: number; identical: number }
    lines: { added: number; removed: number }
    bytes: { a: number; b: number }
  }
  files: FileDiff[]
  skills: SkillChangeSummary[]
}

export type TreeDiffOptions = {
  context?: number
  lines?: boolean
  semantic?: boolean
  include?: (path: string) => boolean
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  const text = Buffer.from(bytes).toString('utf8')
  return Buffer.from(text, 'utf8').equals(Buffer.from(bytes)) ? text : null
}

function sideOf(bytes: Uint8Array | undefined): FileSide {
  return bytes ? { sha256: sha256Bytes(bytes), size: bytes.length } : null
}

function isMarkdown(path: string): boolean {
  return /\.md$/i.test(path)
}

export function pathMatches(path: string, filters: string[]): boolean {
  if (filters.length === 0) return true
  return filters.some(filter => {
    const normalized = filter.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    return path === normalized || path.startsWith(`${normalized}/`)
  })
}

export function diffTrees(
  a: Record<string, Uint8Array>,
  b: Record<string, Uint8Array>,
  opts: TreeDiffOptions = {},
): TreeDiff {
  const include = opts.include ?? (() => true)
  const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(include).sort()
  const files: FileDiff[] = []
  let identicalCount = 0
  let bytesA = 0
  let bytesB = 0
  for (const path of paths) {
    const left = a[path]
    const right = b[path]
    bytesA += left?.length ?? 0
    bytesB += right?.length ?? 0
    const sa = sideOf(left)
    const sb = sideOf(right)
    if (sa && sb && sa.sha256 === sb.sha256) {
      identicalCount++
      continue
    }
    const change: FileDiff['change'] = !sa ? 'added' : !sb ? 'removed' : 'modified'
    const textA = left ? decodeText(left) : ''
    const textB = right ? decodeText(right) : ''
    const entry: FileDiff = { path, change, a: sa, b: sb, added: 0, removed: 0 }
    if (textA === null || textB === null) {
      entry.binary = true
      files.push(entry)
      continue
    }
    if (change === 'modified') {
      if (textA.replace(/\r\n/g, '\n') === textB.replace(/\r\n/g, '\n')) entry.eolOnly = true
      else if (textA.replace(/\n+$/, '') === textB.replace(/\n+$/, '')) entry.trailingNewlineOnly = true
    }
    const lineDiff = diffLines(textA, textB, {
      ...(opts.context !== undefined ? { context: opts.context } : {}),
      ...(isMarkdown(path) ? { headingFor: markdownHeadingFor } : {}),
    })
    entry.added = lineDiff.added
    entry.removed = lineDiff.removed
    if (lineDiff.replaced) entry.replaced = true
    if (opts.lines !== false) entry.hunks = lineDiff.hunks
    if (opts.semantic !== false && change === 'modified') {
      if (isMarkdown(path)) {
        const sections = diffMarkdownSections(textA, textB)
        if (sections.length > 0) entry.sections = sections
      } else if (/\.json$/i.test(path)) {
        const ja = parseJsonOrNull(textA)
        const jb = parseJsonOrNull(textB)
        if (ja !== undefined && jb !== undefined) entry.json = diffJson(ja, jb)
      }
    }
    files.push(entry)
  }
  const skills = new Map<string, SkillChangeSummary>()
  for (const file of files) {
    const match = /^skills\/([^/]+)\/(.+)$/.exec(file.path)
    if (!match) continue
    const [, name, rest] = match
    const summary = skills.get(name!) ?? { skill: name!, change: 'modified', files: [] }
    summary.files.push(rest!)
    skills.set(name!, summary)
  }
  for (const summary of skills.values()) {
    const prefix = `skills/${summary.skill}/`
    const inA = Object.keys(a).some(path => path.startsWith(prefix))
    const inB = Object.keys(b).some(path => path.startsWith(prefix))
    summary.change = !inA ? 'added' : !inB ? 'removed' : 'modified'
  }
  return {
    identical: files.length === 0,
    summary: {
      files: {
        added: files.filter(file => file.change === 'added').length,
        removed: files.filter(file => file.change === 'removed').length,
        modified: files.filter(file => file.change === 'modified').length,
        identical: identicalCount,
      },
      lines: {
        added: files.reduce((sum, file) => sum + file.added, 0),
        removed: files.reduce((sum, file) => sum + file.removed, 0),
      },
      bytes: { a: bytesA, b: bytesB },
    },
    files,
    skills: [...skills.values()],
  }
}
