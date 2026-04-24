export type TextCursor = {
  value: string
  offset: number
}

export type CursorMoveResult = {
  cursor: TextCursor
  moved: boolean
}

export type VisualLine = {
  start: number
  end: number
}

export type VisualLineWindow = {
  start: number
  end: number
}

export function normalizeCursor(value: string, offset: number): TextCursor {
  return { value, offset: clampOffset(value, offset) }
}

export function moveLeft(cursor: TextCursor): TextCursor {
  return normalizeCursor(cursor.value, cursor.offset - 1)
}

export function moveRight(cursor: TextCursor): TextCursor {
  return normalizeCursor(cursor.value, cursor.offset + 1)
}

export function moveVerticalCursor(
  cursor: TextCursor,
  direction: 1 | -1,
  preferredColumn?: number,
): CursorMoveResult {
  const lines = getLogicalLines(cursor.value)
  const position = positionFromOffset(lines, cursor.offset)
  const targetLine = position.line + direction
  if (targetLine < 0 || targetLine >= lines.length) {
    return { cursor, moved: false }
  }
  const targetOffset = offsetFromPosition(lines, targetLine, preferredColumn ?? position.column)
  return {
    cursor: normalizeCursor(cursor.value, targetOffset),
    moved: targetOffset !== cursor.offset,
  }
}

export function getVisualLines(value: string, wrapWidth: number): VisualLine[] {
  const safeWrapWidth = Math.max(1, Math.floor(wrapWidth))
  const lines: VisualLine[] = []
  let start = 0

  for (let index = 0; index <= value.length; index += 1) {
    if (index !== value.length && value[index] !== '\n') continue

    const end = index
    if (start === end) {
      lines.push({ start, end })
    } else {
      for (let chunkStart = start; chunkStart < end; chunkStart += safeWrapWidth) {
        lines.push({ start: chunkStart, end: Math.min(chunkStart + safeWrapWidth, end) })
      }
      if (end === value.length && (end - start) % safeWrapWidth === 0) {
        lines.push({ start: end, end })
      }
    }
    start = index + 1
  }

  return lines.length > 0 ? lines : [{ start: 0, end: 0 }]
}

export function getVisualLineIndex(lines: VisualLine[], offset: number): number {
  return visualPositionFromOffset(lines, offset).line
}

export function getVisibleVisualLineWindow(
  totalLines: number,
  cursorLine: number,
  maxVisibleLines: number,
): VisualLineWindow {
  const safeTotal = Math.max(0, Math.floor(totalLines))
  if (safeTotal === 0) return { start: 0, end: 0 }

  const safeMaxVisible = Math.max(1, Math.floor(maxVisibleLines))
  if (safeTotal <= safeMaxVisible) return { start: 0, end: safeTotal }

  const safeCursorLine = Math.max(0, Math.min(Math.floor(cursorLine), safeTotal - 1))
  const half = Math.floor(safeMaxVisible / 2)
  const start = Math.max(0, Math.min(
    safeCursorLine - half,
    safeTotal - safeMaxVisible,
  ))

  return { start, end: start + safeMaxVisible }
}

export function moveVerticalVisualCursor(
  cursor: TextCursor,
  direction: 1 | -1,
  wrapWidth: number,
  preferredColumn?: number,
): CursorMoveResult {
  const lines = getVisualLines(cursor.value, wrapWidth)
  const position = visualPositionFromOffset(lines, cursor.offset)
  const targetLine = position.line + direction
  if (targetLine < 0 || targetLine >= lines.length) {
    return { cursor, moved: false }
  }
  const target = lines[targetLine]!
  const targetColumn = Math.min(preferredColumn ?? position.column, target.end - target.start)
  const targetOffset = target.start + Math.max(0, targetColumn)
  return {
    cursor: normalizeCursor(cursor.value, targetOffset),
    moved: targetOffset !== cursor.offset,
  }
}

export function cursorOnLastLine(value: string, offset: number): TextCursor {
  const lines = getLogicalLines(value)
  const lastLine = Math.max(0, lines.length - 1)
  return normalizeCursor(value, offsetFromPosition(lines, lastLine, 0))
}

export function cursorOnLastLineAtColumn(value: string, column: number): TextCursor {
  const lines = getLogicalLines(value)
  const lastLine = Math.max(0, lines.length - 1)
  return normalizeCursor(value, offsetFromPosition(lines, lastLine, column))
}

export function cursorColumn(value: string, offset: number): number {
  return positionFromOffset(getLogicalLines(value), clampOffset(value, offset)).column
}

type LogicalLine = {
  start: number
  end: number
}

function getLogicalLines(value: string): LogicalLine[] {
  const lines: LogicalLine[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\n') {
      lines.push({ start, end: index })
      start = index + 1
    }
  }
  lines.push({ start, end: value.length })
  return lines
}

function positionFromOffset(lines: LogicalLine[], rawOffset: number): { line: number; column: number } {
  const offset = Math.max(0, rawOffset)
  for (let line = 0; line < lines.length; line += 1) {
    const entry = lines[line]!
    const next = lines[line + 1]
    if (!next || offset < next.start) {
      return {
        line,
        column: Math.max(0, Math.min(offset, entry.end) - entry.start),
      }
    }
  }
  const last = lines[lines.length - 1]!
  return { line: lines.length - 1, column: last.end - last.start }
}

function offsetFromPosition(lines: LogicalLine[], line: number, column: number): number {
  const entry = lines[Math.max(0, Math.min(line, lines.length - 1))]!
  return entry.start + Math.min(Math.max(0, column), entry.end - entry.start)
}

function visualPositionFromOffset(lines: VisualLine[], rawOffset: number): { line: number; column: number } {
  const offset = Math.max(0, rawOffset)
  for (let line = 0; line < lines.length; line += 1) {
    const entry = lines[line]!
    if (entry.start === entry.end && offset === entry.start) {
      return { line, column: 0 }
    }
    if (offset >= entry.start && offset < entry.end) {
      return { line, column: offset - entry.start }
    }
  }

  for (let line = lines.length - 1; line >= 0; line -= 1) {
    const entry = lines[line]!
    if (offset === entry.end) {
      return { line, column: entry.end - entry.start }
    }
  }

  const last = lines[lines.length - 1]!
  return { line: lines.length - 1, column: last.end - last.start }
}

function clampOffset(value: string, offset: number): number {
  return Math.max(0, Math.min(value.length, offset))
}
