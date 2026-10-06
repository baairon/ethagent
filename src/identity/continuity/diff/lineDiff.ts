export type DiffOp = ' ' | '+' | '-'

export type DiffLine = { op: DiffOp; text: string; a?: number; b?: number; noNewline?: true }

export type Hunk = {
  aStart: number
  aLines: number
  bStart: number
  bLines: number
  heading?: string
  lines: DiffLine[]
}

export type LineDiff = { added: number; removed: number; hunks: Hunk[]; replaced: boolean }

type Side = { lines: string[]; keys: string[]; noFinalNewline: boolean }

const NO_NEWLINE_KEY = '\u0000no-newline'

function side(text: string): Side {
  if (text === '') return { lines: [], keys: [], noFinalNewline: false }
  const noFinalNewline = !text.endsWith('\n')
  const lines = text.split('\n')
  if (!noFinalNewline) lines.pop()
  const keys = lines.slice()
  if (noFinalNewline && keys.length > 0) keys[keys.length - 1] += NO_NEWLINE_KEY
  return { lines, keys, noFinalNewline }
}

type Edit = { op: DiffOp; a: number; b: number }

function myers(a: string[], b: string[], maxD: number): Edit[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)
        ? v[k + 1 + offset]!
        : v[k - 1 + offset]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[k + offset] = x
    }
    trace.push(v.slice(offset - d, offset + d + 1))
    const end = n - m
    if (end >= -d && end <= d && (end + d) % 2 === 0 && v[end + offset]! >= n) {
      found = d
      break
    }
  }
  if (found < 0) return null
  const edits: Edit[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1]!
    const at = (k: number): number => prev[k + d - 1]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      edits.push({ op: ' ', a: x - 1, b: y - 1 })
      x--
      y--
    }
    if (prevK === k + 1) edits.push({ op: '+', a: x, b: y - 1 })
    else edits.push({ op: '-', a: x - 1, b: y })
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    edits.push({ op: ' ', a: x - 1, b: y - 1 })
    x--
    y--
  }
  return edits.reverse()
}

export function diffLines(
  aText: string,
  bText: string,
  opts: { context?: number; maxD?: number; headingFor?: (lines: string[], index: number) => string | undefined } = {},
): LineDiff {
  const context = Math.max(0, opts.context ?? 3)
  const a = side(aText)
  const b = side(bText)
  let prefix = 0
  while (prefix < a.keys.length && prefix < b.keys.length && a.keys[prefix] === b.keys[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.keys.length - prefix
    && suffix < b.keys.length - prefix
    && a.keys[a.keys.length - 1 - suffix] === b.keys[b.keys.length - 1 - suffix]
  ) suffix++
  const middle = myers(
    a.keys.slice(prefix, a.keys.length - suffix),
    b.keys.slice(prefix, b.keys.length - suffix),
    opts.maxD ?? 2000,
  )
  let edits: Edit[]
  let replaced = false
  if (middle) {
    edits = [
      ...Array.from({ length: prefix }, (_, i) => ({ op: ' ' as const, a: i, b: i })),
      ...middle.map(edit => ({ op: edit.op, a: edit.a + prefix, b: edit.b + prefix })),
      ...Array.from({ length: suffix }, (_, i) => ({
        op: ' ' as const,
        a: a.keys.length - suffix + i,
        b: b.keys.length - suffix + i,
      })),
    ]
  } else {
    replaced = true
    edits = [
      ...a.lines.map((_, i) => ({ op: '-' as const, a: i, b: 0 })),
      ...b.lines.map((_, i) => ({ op: '+' as const, a: a.lines.length, b: i })),
    ]
  }
  let added = 0
  let removed = 0
  const changeIdx: number[] = []
  edits.forEach((edit, i) => {
    if (edit.op === '+') added++
    if (edit.op === '-') removed++
    if (edit.op !== ' ') changeIdx.push(i)
  })
  const hunks: Hunk[] = []
  let i = 0
  while (i < changeIdx.length) {
    const start = Math.max(0, changeIdx[i]! - context)
    let end = Math.min(edits.length - 1, changeIdx[i]! + context)
    while (i + 1 < changeIdx.length && changeIdx[i + 1]! - context <= end + 1) {
      i++
      end = Math.min(edits.length - 1, changeIdx[i]! + context)
    }
    i++
    const slice = edits.slice(start, end + 1)
    const lines: DiffLine[] = slice.map(edit => {
      const fromA = edit.op !== '+'
      const text = fromA ? a.lines[edit.a]! : b.lines[edit.b]!
      const isLastA = fromA && edit.a === a.lines.length - 1 && a.noFinalNewline
      const isLastB = edit.op !== '-' && edit.b === b.lines.length - 1 && b.noFinalNewline
      return {
        op: edit.op,
        text,
        ...(edit.op !== '+' ? { a: edit.a + 1 } : {}),
        ...(edit.op !== '-' ? { b: edit.b + 1 } : {}),
        ...((edit.op === '-' && isLastA) || (edit.op === '+' && isLastB) || (edit.op === ' ' && isLastA) ? { noNewline: true as const } : {}),
      }
    })
    const firstA = slice.find(edit => edit.op !== '+')
    const firstB = slice.find(edit => edit.op !== '-')
    const aLines = slice.filter(edit => edit.op !== '+').length
    const bLines = slice.filter(edit => edit.op !== '-').length
    const aStart = firstA ? firstA.a + 1 : slice[0]!.a
    const bStart = firstB ? firstB.b + 1 : slice[0]!.b
    const firstChange = slice.find(edit => edit.op !== ' ')!
    const heading = firstChange.op === '+'
      ? opts.headingFor?.(b.lines, firstChange.b)
      : opts.headingFor?.(a.lines, firstChange.a)
    hunks.push({ aStart, aLines, bStart, bLines, ...(heading ? { heading } : {}), lines })
  }
  return { added, removed, hunks, replaced }
}

export function markdownHeadingFor(lines: string[], index: number): string | undefined {
  let fenced = false
  let heading: string | undefined
  for (let i = 0; i <= Math.min(index, lines.length - 1); i++) {
    const line = lines[i]!.replace(/\r$/, '')
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (!fenced && /^#{1,6}\s+\S/.test(line)) heading = line.trim()
  }
  return heading
}

export function renderUnifiedPatch(diff: LineDiff, labels: { a: string; b: string }): string {
  if (diff.hunks.length === 0) return ''
  const out = [`--- ${labels.a}`, `+++ ${labels.b}`]
  for (const hunk of diff.hunks) {
    out.push(`@@ -${hunk.aStart},${hunk.aLines} +${hunk.bStart},${hunk.bLines} @@${hunk.heading ? ` ${hunk.heading}` : ''}`)
    for (const line of hunk.lines) {
      out.push(`${line.op}${line.text}`)
      if (line.noNewline) out.push('\\ No newline at end of file')
    }
  }
  return `${out.join('\n')}\n`
}
