import type { MessageRow } from '../MessageList.js'
import { flattenAssistantBody } from '../MessageList.js'

export type TranscriptAnchor = {
  rowId: string
  offset: number
}

export type TranscriptViewportState = {
  scrollTopLine: number
  followTail: boolean
  anchor: TranscriptAnchor | null
}

export type RowSlice<T> = {
  row: T
  clipStart: number
  clipEnd: number
  rowHeight: number
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
  rows: Array<RowSlice<T>>
  hiddenCount: number
}

export type TranscriptWindowSelection<T> = {
  rows: Array<RowSlice<T>>
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
  const slice = rows.slice(firstVisible).map(row => {
    const height = Math.max(1, estimateHeight(row))
    return { row, clipStart: 0, clipEnd: height, rowHeight: height }
  })
  return {
    rows: slice,
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

  return selectRowsForLineWindow(rows, heights, offsets, budget, startLine, totalLines, maxScrollOffset)
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

  return selectRowsForLineWindow(rows, heights, offsets, budget, startLine, totalLines, maxScrollOffset)
}

export function scrollTopForPageUp(
  scrollTopLine: number,
  maxScrollTop: number,
  viewportLines: number,
): number {
  return clampLine(scrollTopLine - pageScrollDistance(viewportLines), maxScrollTop)
}

export function scrollTopForPageDown(
  scrollTopLine: number,
  maxScrollTop: number,
  viewportLines: number,
): number {
  return clampLine(scrollTopLine + pageScrollDistance(viewportLines), maxScrollTop)
}

function pageScrollDistance(viewportLines: number): number {
  const viewport = Math.max(1, Math.floor(viewportLines))
  return Math.max(1, viewport - 2)
}

function selectRowsForLineWindow<T>(
  rows: T[],
  heights: number[],
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

  const slices: Array<RowSlice<T>> = []
  for (let i = startIndex; i < endIndex; i += 1) {
    const row = rows[i]
    if (!row) continue
    const rowTop = offsets[i] ?? 0
    const height = heights[i] ?? 1
    const clipStart = Math.max(0, startLine - rowTop)
    const clipEnd = Math.min(height, endLine - rowTop)
    if (clipEnd <= clipStart) continue
    slices.push({ row, clipStart, clipEnd, rowHeight: height })
  }

  return {
    rows: slices,
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
      return userRowLineCount(row.content, contentWidth)
    case 'assistant':
      return assistantRowLineCount(row.content, row.liveTail ?? '', contentWidth, Boolean(row.streaming))
    case 'thinking':
      return thinkingRowLineCount(row, contentWidth)
    case 'tool_call':
      return 1
    case 'note':
      return 1 + wrappedLineCount(row.content, contentWidth)
    case 'progress':
      return 4
    case 'splash':
      return 28
  }
}

export function userRowLineCount(content: string, contentWidth: number): number {
  const lines = splitLines(content)
  return 1 + lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / contentWidth)), 0)
}

export function assistantRowLineCount(content: string, liveTail: string, _contentWidth: number, streaming = false): number {
  const fullText = liveTail ? content + liveTail : content
  return 1 + flattenAssistantBody(fullText, streaming).length
}

export function thinkingRowLineCount(
  row: Extract<MessageRow, { role: 'thinking' }>,
  _contentWidth: number,
): number {
  const omitted = thinkingDisplayOmittedChars(row)
  const overhead = 1 + (omitted > 0 ? 1 : 0) + 1
  if (!row.expanded) return overhead
  const body = thinkingDisplayBody(row)
  const lines = splitLines(body)
  return overhead + lines.length
}

export function thinkingDisplayBody(row: Extract<MessageRow, { role: 'thinking' }>): string {
  const text = row.liveTail ? row.content + row.liveTail : row.content
  return clipReasoningForDisplayText(text)
}

export function thinkingDisplayOmittedChars(row: Extract<MessageRow, { role: 'thinking' }>): number {
  const text = row.liveTail ? row.content + row.liveTail : row.content
  return clipReasoningForDisplayOmitted(text)
}

const MAX_RENDERED_REASONING_CHARS = 10_000

function clipReasoningForDisplayText(text: string): string {
  if (text.length <= MAX_RENDERED_REASONING_CHARS) return text
  const rawStart = Math.max(0, text.length - MAX_RENDERED_REASONING_CHARS)
  const newline = text.indexOf('\n', rawStart)
  const start = newline >= 0 && newline - rawStart <= 240 ? newline + 1 : rawStart
  return text.slice(start)
}

function clipReasoningForDisplayOmitted(text: string): number {
  if (text.length <= MAX_RENDERED_REASONING_CHARS) return 0
  const rawStart = Math.max(0, text.length - MAX_RENDERED_REASONING_CHARS)
  const newline = text.indexOf('\n', rawStart)
  return newline >= 0 && newline - rawStart <= 240 ? newline + 1 : rawStart
}

export function splitLines(text: string): string[] {
  if (!text) return ['']
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return normalized.split('\n')
}

function wrappedLineCount(text: string, width: number): number {
  if (!text) return 1
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / width)), 0)
}
