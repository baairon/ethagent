import wrapAnsi from 'wrap-ansi'

export function wrapWords(text: string, width: number): string[] {
  const limit = Math.max(1, Math.floor(width))
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    out.push(...wrapAnsi(words.join(' '), limit, { hard: true }).split('\n'))
  }
  return out
}

export type TextRow = {
  start: number
  end: number
  next: number
  last: boolean
}

const NO_BREAK_SPACE = ' '

export function layoutTextRows(value: string, width: number): TextRow[] {
  const columns = Math.max(1, Math.floor(width))
  const rows: TextRow[] = []
  let lineStart = 0
  for (const line of value.split('\n')) {
    const lineEnd = lineStart + line.length
    const lineRows: TextRow[] = []
    const indent = line.length - line.trimStart().length
    const guarded = NO_BREAK_SPACE.repeat(indent) + line.slice(indent)
    const pieces = line.trim() ? wrapAnsi(guarded, columns, { hard: true }).split('\n') : []
    let offset = 0
    for (const piece of pieces) {
      if (!piece) continue
      const at = guarded.indexOf(piece, offset)
      if (at < 0) {
        for (let start = offset; start < line.length; start += columns) {
          lineRows.push({ start: lineStart + start, end: lineStart + Math.min(line.length, start + columns), next: 0, last: false })
        }
        break
      }
      lineRows.push({ start: lineStart + at, end: lineStart + at + piece.length, next: 0, last: false })
      offset = at + piece.length
    }
    if (lineRows.length === 0) lineRows.push({ start: lineStart, end: lineStart, next: lineEnd, last: true })
    lineRows[0]!.start = lineStart
    lineRows.forEach((row, index) => {
      const following = lineRows[index + 1]
      row.next = following ? following.start : lineEnd
      row.last = !following
    })
    rows.push(...lineRows)
    lineStart = lineEnd + 1
  }
  return rows
}

export function rowIndexAt(rows: readonly TextRow[], offset: number): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]!.start <= offset) return index
  }
  return 0
}

export function moveAcrossRows(rows: readonly TextRow[], offset: number, delta: number): number {
  const from = rowIndexAt(rows, offset)
  const target = rows[from + delta]
  if (!target) return offset
  const column = offset - rows[from]!.start
  const lastOffset = target.last ? target.next : Math.max(target.start, target.next - 1)
  return Math.min(target.start + column, lastOffset)
}

export function prevCharBoundary(value: string, offset: number): number {
  if (offset <= 0) return 0
  const low = value.charCodeAt(offset - 1)
  const high = value.charCodeAt(offset - 2)
  const pair = offset >= 2 && low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff
  return offset - (pair ? 2 : 1)
}

export function nextCharBoundary(value: string, offset: number): number {
  if (offset >= value.length) return value.length
  const code = value.codePointAt(offset) ?? 0
  return Math.min(value.length, offset + (code > 0xffff ? 2 : 1))
}

export function charAt(value: string, offset: number): string {
  return value.slice(offset, nextCharBoundary(value, offset))
}

export function cleanTypedText(input: string, multiline: boolean): string {
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .normalize()
  return multiline ? text : text.replace(/\n/g, '')
}

export function asSentence(value: string): string {
  const trimmed = value.trim()
  return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

export function truncateEnd(value: string, max: number): string {
  const limit = Math.max(1, Math.floor(max))
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export function firstThatFits(candidates: readonly string[], budget: number): string | null {
  for (const candidate of candidates) {
    if (candidate.length <= budget) return candidate
  }
  return null
}

export function joinWithMore(items: readonly string[], budget: number, separator = ', '): string | null {
  const all = items.join(separator)
  if (all.length <= budget) return all
  for (let shown = items.length - 1; shown >= 1; shown -= 1) {
    const candidate = `${items.slice(0, shown).join(separator)} +${items.length - shown} more`
    if (candidate.length <= budget) return candidate
  }
  return null
}

export function middleEllipsis(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
