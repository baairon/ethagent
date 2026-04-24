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
