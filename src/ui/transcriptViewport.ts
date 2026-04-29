import type { MessageRow } from './MessageList.js'

export type TranscriptAnchor = {
  rowId: string
  offset: number
}

export type TranscriptViewportState = {
  scrollTopLine: number
  followTail: boolean
  anchor: TranscriptAnchor | null
}

export function buildLineOffsets(rowHeights: number[]): number[] {
  const out = new Array<number>(rowHeights.length + 1).fill(0)
  for (let i = 0; i < rowHeights.length; i += 1) {
    out[i + 1] = out[i]! + (rowHeights[i] ?? 1)
  }
  return out
}

export function findRowIndexAtLine(offsets: number[], line: number): number {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if ((offsets[mid] ?? 0) <= line) low = mid
    else high = mid - 1
  }
  return low
}

export function anchorForScrollTop(
  rowIds: string[],
  offsets: number[],
  scrollTopLine: number,
): TranscriptAnchor | null {
  if (rowIds.length === 0) return null
  const rowIndex = Math.min(rowIds.length - 1, findRowIndexAtLine(offsets, scrollTopLine))
  const rowId = rowIds[rowIndex]
  if (!rowId) return null
  return {
    rowId,
    offset: Math.max(0, scrollTopLine - (offsets[rowIndex] ?? 0)),
  }
}

export function resolveScrollTopFromAnchor(
  rowIds: string[],
  offsets: number[],
  anchor: TranscriptAnchor | null,
  maxScrollTop: number,
): number | null {
  if (!anchor) return null
  const rowIndex = rowIds.indexOf(anchor.rowId)
  if (rowIndex === -1) return null
  return clampLine((offsets[rowIndex] ?? 0) + anchor.offset, maxScrollTop)
}

export function clampLine(line: number, maxScrollTop: number): number {
  return Math.max(0, Math.min(maxScrollTop, Math.floor(line)))
}

export type TranscriptTailSelection<T> = {
  rows: T[]
  hiddenCount: number
}

export type TranscriptWindowSelection<T> = {
  rows: T[]
  hiddenBefore: number
  hiddenAfter: number
  totalLines: number
  maxScrollOffset: number
}

export function selectTailRowsForViewport<T>(
  rows: T[],
  maxLines: number,
  estimateHeight: (row: T) => number,
): TranscriptTailSelection<T> {
  if (rows.length === 0) return { rows: [], hiddenCount: 0 }

  const budget = Math.max(1, Math.floor(maxLines))
  let used = 0
  let start = rows.length - 1

  for (; start >= 0; start -= 1) {
    const row = rows[start]
    if (!row) break
    const height = Math.max(1, estimateHeight(row))
    if (used > 0 && used + height > budget) break
    used += height
  }

  const firstVisible = Math.max(0, start + 1)
  return {
    rows: rows.slice(firstVisible),
    hiddenCount: firstVisible,
  }
}

export function selectRowsForScrollOffset<T>(
  rows: T[],
  maxLines: number,
  scrollOffsetFromTail: number,
  estimateHeight: (row: T) => number,
): TranscriptWindowSelection<T> {
  if (rows.length === 0) {
    return { rows: [], hiddenBefore: 0, hiddenAfter: 0, totalLines: 0, maxScrollOffset: 0 }
  }

  const budget = Math.max(1, Math.floor(maxLines))
  const heights = rows.map(row => Math.max(1, estimateHeight(row)))
  const offsets = buildLineOffsets(heights)
  const totalLines = offsets[offsets.length - 1] ?? 0
  const maxScrollOffset = Math.max(0, totalLines - budget)
  const scrollOffset = clampLine(scrollOffsetFromTail, maxScrollOffset)
  const startLine = Math.max(0, totalLines - budget - scrollOffset)

  return selectRowsForLineWindow(rows, offsets, budget, startLine, totalLines, maxScrollOffset)
}

export function selectRowsForScrollTop<T>(
  rows: T[],
  maxLines: number,
  scrollTopLine: number,
  estimateHeight: (row: T) => number,
): TranscriptWindowSelection<T> {
  if (rows.length === 0) {
    return { rows: [], hiddenBefore: 0, hiddenAfter: 0, totalLines: 0, maxScrollOffset: 0 }
  }

  const budget = Math.max(1, Math.floor(maxLines))
  const heights = rows.map(row => Math.max(1, estimateHeight(row)))
  const offsets = buildLineOffsets(heights)
  const totalLines = offsets[offsets.length - 1] ?? 0
  const maxScrollOffset = Math.max(0, totalLines - budget)
  const startLine = clampLine(scrollTopLine, maxScrollOffset)

  return selectRowsForLineWindow(rows, offsets, budget, startLine, totalLines, maxScrollOffset)
}

export function promptScrollTopForPageUp(
  rows: MessageRow[],
  offsets: number[],
  scrollTopLine: number,
  maxScrollTop: number,
  followTail: boolean,
): number {
  const promptStarts = promptScrollTops(rows, offsets)
  if (promptStarts.length === 0) return clampLine(scrollTopLine, maxScrollTop)
  if (followTail) return clampLine(promptStarts[promptStarts.length - 1]!, maxScrollTop)

  const currentLine = clampLine(scrollTopLine, maxScrollTop)
  for (let index = promptStarts.length - 1; index >= 0; index -= 1) {
    const line = promptStarts[index]!
    if (line < currentLine) return clampLine(line, maxScrollTop)
  }
  return 0
}

export function promptScrollTopForPageDown(
  rows: MessageRow[],
  offsets: number[],
  scrollTopLine: number,
  maxScrollTop: number,
): number {
  const promptStarts = promptScrollTops(rows, offsets)
  if (promptStarts.length === 0) return clampLine(scrollTopLine, maxScrollTop)

  const currentLine = clampLine(scrollTopLine, maxScrollTop)
  const next = promptStarts.find(line => line > currentLine)
  return next === undefined ? maxScrollTop : clampLine(next, maxScrollTop)
}

function promptScrollTops(rows: MessageRow[], offsets: number[]): number[] {
  const starts: number[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.role === 'user') starts.push(offsets[index] ?? 0)
  }
  return starts
}

function selectRowsForLineWindow<T>(
  rows: T[],
  offsets: number[],
  budget: number,
  startLine: number,
  totalLines: number,
  maxScrollOffset: number,
): TranscriptWindowSelection<T> {
  const endLine = Math.min(totalLines, startLine + budget)

  const startIndex = Math.min(rows.length - 1, findRowIndexAtLine(offsets, startLine))
  const lastVisibleLine = Math.max(startLine, endLine - 1)
  const endIndex = endLine >= totalLines
    ? rows.length
    : Math.min(rows.length, findRowIndexAtLine(offsets, lastVisibleLine) + 1)

  return {
    rows: rows.slice(startIndex, endIndex),
    hiddenBefore: startIndex,
    hiddenAfter: rows.length - endIndex,
    totalLines,
    maxScrollOffset,
  }
}

export function estimateMessageRowHeight(row: MessageRow, columns = 80): number {
  const contentWidth = Math.max(20, columns - 8)
  switch (row.role) {
    case 'user':
      return 1 + wrappedLineCount(row.content, contentWidth)
    case 'assistant':
      return 1 + wrappedLineCount([row.content, row.liveTail ?? ''].filter(Boolean).join('\n'), contentWidth)
    case 'thinking':
      return row.expanded
        ? 3 + wrappedLineCount([row.content, row.liveTail ?? ''].filter(Boolean).join('\n'), contentWidth)
        : 3 + wrappedLineCount(reasoningPreview(row), contentWidth)
    case 'tool_use':
      return 3 + (row.input ? wrappedLineCount(row.input, contentWidth) : 0)
    case 'tool_result':
      return 3 + wrappedLineCount(row.content, contentWidth)
    case 'note':
      return 1 + wrappedLineCount(row.content, contentWidth)
    case 'progress':
      return 4
  }
}

function reasoningPreview(row: Extract<MessageRow, { role: 'thinking' }>): string {
  const normalized = [row.content, row.liveTail ?? ''].filter(Boolean).join('').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'thinking...'
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117)}...`
}

function wrappedLineCount(text: string, width: number): number {
  if (!text) return 1
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0)
}
