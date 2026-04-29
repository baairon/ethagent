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
