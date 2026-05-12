export const DEFAULT_DIFF_CONTEXT_LINES = 3
export const DEFAULT_DIFF_MAX_CHARS = 2400
export const FILE_DIFF_RESULT_MARKER = '\n\n<!-- ethagent:file-diff:v1 -->\n'

type DiffOp =
  | { type: 'equal'; line: string }
  | { type: 'delete'; line: string }
  | { type: 'insert'; line: string }

type HunkRange = {
  start: number
  end: number
}

type RenderUnifiedFileDiffInput = {
  filePath: string
  before: string
  after: string
  contextLines?: number
  maxChars?: number
}

const LARGE_DIFF_MATRIX_LIMIT = 500_000

export function renderUnifiedFileDiff(input: RenderUnifiedFileDiffInput): string {
  const contextLines = input.contextLines ?? DEFAULT_DIFF_CONTEXT_LINES
  const maxChars = input.maxChars ?? DEFAULT_DIFF_MAX_CHARS
  const header = [`--- ${input.filePath}`, `+++ ${input.filePath}`]

  if (input.before === input.after) {
    return header.concat('(no changes)').join('\n')
  }

  const beforeLines = normalizedLines(input.before)
  const afterLines = normalizedLines(input.after)
  const ops = buildLineDiff(beforeLines, afterLines)
  const hunks = buildHunkRanges(ops, contextLines)

  if (hunks.length === 0) {
    return header.concat('(only line ending changes)').join('\n')
  }

  const lines = [...header]
  for (const hunk of hunks) {
    const oldStart = countOldLines(ops, 0, hunk.start) + 1
    const newStart = countNewLines(ops, 0, hunk.start) + 1
    const oldCount = countOldLines(ops, hunk.start, hunk.end)
    const newCount = countNewLines(ops, hunk.start, hunk.end)
    lines.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`)
    for (const op of ops.slice(hunk.start, hunk.end)) {
      if (op.type === 'equal') lines.push(` ${op.line}`)
      else if (op.type === 'delete') lines.push(`-${op.line}`)
      else lines.push(`+${op.line}`)
    }
  }

  return truncateDiff(lines, maxChars)
}

export function formatFileChangeResult(content: string, diff: string): string {
  return `${content}${FILE_DIFF_RESULT_MARKER}${diff}`
}

export function splitFileChangeResult(content: string): { content: string; diff?: string } {
  const markerIndex = content.indexOf(FILE_DIFF_RESULT_MARKER)
  if (markerIndex === -1) return { content }
  const diff = content.slice(markerIndex + FILE_DIFF_RESULT_MARKER.length).trimEnd()
  return {
    content: content.slice(0, markerIndex).trimEnd(),
    diff: diff.length > 0 ? diff : undefined,
  }
}

export function stripFileChangeResultDiff(content: string): string {
  return splitFileChangeResult(content).content
}

export function computeLineDiffStats(before: string, after: string): { inserts: number; deletes: number } {
  if (before === after) return { inserts: 0, deletes: 0 }
  const beforeLines = normalizedLines(before)
  const afterLines = normalizedLines(after)
  const ops = buildLineDiff(beforeLines, afterLines)
  let inserts = 0
  let deletes = 0
  for (const op of ops) {
    if (op.type === 'insert') inserts += 1
    else if (op.type === 'delete') deletes += 1
  }
  return { inserts, deletes }
}

function buildLineDiff(beforeLines: string[], afterLines: string[]): DiffOp[] {
  if (beforeLines.length * afterLines.length > LARGE_DIFF_MATRIX_LIMIT) {
    return buildPrefixSuffixDiff(beforeLines, afterLines)
  }

  const lengths = lcsLengths(beforeLines, afterLines)
  const ops: DiffOp[] = []
  let beforeIndex = 0
  let afterIndex = 0

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex]!
    const afterLine = afterLines[afterIndex]!
    if (beforeLine === afterLine) {
      ops.push({ type: 'equal', line: beforeLine })
      beforeIndex += 1
      afterIndex += 1
      continue
    }

    const deleteScore = lengths[beforeIndex + 1]![afterIndex]!
    const insertScore = lengths[beforeIndex]![afterIndex + 1]!
    const deleteRevealsMatch = beforeLines[beforeIndex + 1] === afterLine
    const insertRevealsMatch = beforeLine === afterLines[afterIndex + 1]

    if (insertRevealsMatch && insertScore >= deleteScore) {
      ops.push({ type: 'insert', line: afterLine })
      afterIndex += 1
    } else if (deleteRevealsMatch && deleteScore >= insertScore) {
      ops.push({ type: 'delete', line: beforeLine })
      beforeIndex += 1
    } else if (deleteScore >= insertScore) {
      ops.push({ type: 'delete', line: beforeLine })
      beforeIndex += 1
    } else {
      ops.push({ type: 'insert', line: afterLine })
      afterIndex += 1
    }
  }

  while (beforeIndex < beforeLines.length) {
    ops.push({ type: 'delete', line: beforeLines[beforeIndex]! })
    beforeIndex += 1
  }
  while (afterIndex < afterLines.length) {
    ops.push({ type: 'insert', line: afterLines[afterIndex]! })
    afterIndex += 1
  }

  return ops
}

function buildPrefixSuffixDiff(beforeLines: string[], afterLines: string[]): DiffOp[] {
  let prefixLength = 0
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1
  }

  let beforeEnd = beforeLines.length
  let afterEnd = afterLines.length
  while (
    beforeEnd > prefixLength &&
    afterEnd > prefixLength &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  const ops: DiffOp[] = []
  for (let index = 0; index < prefixLength; index += 1) {
    ops.push({ type: 'equal', line: beforeLines[index]! })
  }
  for (let index = prefixLength; index < beforeEnd; index += 1) {
    ops.push({ type: 'delete', line: beforeLines[index]! })
  }
  for (let index = prefixLength; index < afterEnd; index += 1) {
    ops.push({ type: 'insert', line: afterLines[index]! })
  }
  for (let index = beforeEnd; index < beforeLines.length; index += 1) {
    ops.push({ type: 'equal', line: beforeLines[index]! })
  }
  return ops
}

function lcsLengths(beforeLines: string[], afterLines: string[]): number[][] {
  const lengths = Array.from(
    { length: beforeLines.length + 1 },
    () => Array<number>(afterLines.length + 1).fill(0),
  )

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] = beforeLines[beforeIndex] === afterLines[afterIndex]
        ? lengths[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(lengths[beforeIndex + 1]![afterIndex]!, lengths[beforeIndex]![afterIndex + 1]!)
    }
  }

  return lengths
}

function buildHunkRanges(ops: DiffOp[], contextLines: number): HunkRange[] {
  const ranges: HunkRange[] = []
  const context = Math.max(0, contextLines)

  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index]?.type === 'equal') continue
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length, index + context + 1)
    const previous = ranges[ranges.length - 1]
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end)
    } else {
      ranges.push({ start, end })
    }
  }

  return ranges
}

function countOldLines(ops: DiffOp[], start: number, end: number): number {
  let count = 0
  for (let index = start; index < end; index += 1) {
    const type = ops[index]?.type
    if (type === 'equal' || type === 'delete') count += 1
  }
  return count
}

function countNewLines(ops: DiffOp[], start: number, end: number): number {
  let count = 0
  for (let index = start; index < end; index += 1) {
    const type = ops[index]?.type
    if (type === 'equal' || type === 'insert') count += 1
  }
  return count
}

function formatRange(start: number, count: number): string {
  if (count === 0) return `${Math.max(0, start - 1)},0`
  if (count === 1) return String(start)
  return `${start},${count}`
}

function normalizedLines(value: string): string[] {
  if (value.length === 0) return []
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function truncateDiff(lines: string[], maxChars: number): string {
  const diff = lines.join('\n')
  if (diff.length <= maxChars) return diff

  const out: string[] = []
  let length = 0
  for (const line of lines) {
    const nextLength = length + (out.length > 0 ? 1 : 0) + line.length
    if (nextLength > maxChars) break
    out.push(line)
    length = nextLength
  }
  return out.join('\n')
}
