import {
  cursorColumn,
  cursorOnLastLineAtColumn,
  getVisualLines,
  moveVerticalVisualCursor,
  moveVerticalCursor,
  normalizeCursor,
} from './textCursor.js'

export type ChatBuffer = {
  value: string
  cursor: number
}

export type FileMentionToken = {
  start: number
  end: number
  query: string
}

export type HistoryPreviewState = {
  historyIndex: number | null
  historyPreviewActive: boolean
  draftBuffer: ChatBuffer
  preferredColumn: number | null
}

export type VerticalMoveResult =
  | { kind: 'moved'; cursor: number; preferredColumn: number }
  | { kind: 'boundary-top'; cursor: number; preferredColumn: number }
  | { kind: 'boundary-bottom'; cursor: number; preferredColumn: number }

export function emptyBuffer(): ChatBuffer {
  return { value: '', cursor: 0 }
}

export function bufferFromValue(value: string, cursor = value.length): ChatBuffer {
  const next = normalizeCursor(value, cursor)
  return { value: next.value, cursor: next.offset }
}

export function canNavigateHistory(
  _buffer: ChatBuffer,
  historyLength: number,
  _historyIndex: number | null,
  _historyPreviewActive: boolean,
): boolean {
  return historyLength > 0
}

export function beginHistoryPreview(
  buffer: ChatBuffer,
  history: string[],
  direction: 1 | -1,
  _preferredColumn: number | null,
): { preview: HistoryPreviewState; buffer: ChatBuffer } | null {
  if (history.length === 0) return null
  const nextIndex = direction === -1 ? history.length - 1 : 0
  const chosen = history[nextIndex] ?? ''
  return {
    preview: {
      historyIndex: nextIndex,
      historyPreviewActive: true,
      draftBuffer: buffer,
      preferredColumn: null,
    },
    buffer: bufferFromValue(chosen),
  }
}

export function moveThroughHistory(
  history: string[],
  historyIndex: number,
  direction: 1 | -1,
  draftBuffer: ChatBuffer,
  preferredColumn: number | null,
): { preview: HistoryPreviewState; buffer: ChatBuffer } {
  const next = historyIndex + direction
  if (next < 0) {
    const chosen = history[0] ?? ''
    return {
      preview: {
        historyIndex: 0,
        historyPreviewActive: true,
        draftBuffer,
        preferredColumn: null,
      },
      buffer: bufferFromValue(chosen),
    }
  }
  if (next >= history.length) {
    return {
      preview: {
        historyIndex: null,
        historyPreviewActive: false,
        draftBuffer,
        preferredColumn: null,
      },
      buffer: bufferFromValue(draftBuffer.value),
    }
  }
  const chosen = history[next] ?? ''
  return {
    preview: {
      historyIndex: next,
      historyPreviewActive: true,
      draftBuffer,
      preferredColumn: null,
    },
    buffer: bufferFromValue(chosen),
  }
}

export function exitHistoryPreview(
  buffer: ChatBuffer,
): { historyIndex: null; historyPreviewActive: false; draftBuffer: ChatBuffer; preferredColumn: null } {
  return {
    historyIndex: null,
    historyPreviewActive: false,
    draftBuffer: buffer,
    preferredColumn: null,
  }
}

export function bufferFromLastLine(value: string, preferredColumn: number | null = null): ChatBuffer {
  const next = cursorOnLastLineAtColumn(value, preferredColumn ?? 0)
  return { value: next.value, cursor: next.offset }
}

export function deleteToLineStart(buffer: ChatBuffer, wrapWidth: number): ChatBuffer {
  const normalized = normalizeCursor(buffer.value, buffer.cursor)
  const { value, offset } = normalized
  if (offset <= 0) return { value, cursor: 0 }

  if (value[offset - 1] === '\n') {
    return {
      value: value.slice(0, offset - 1) + value.slice(offset),
      cursor: offset - 1,
    }
  }

  const lineStart = visualLineStart(value, offset, wrapWidth)
  return {
    value: value.slice(0, lineStart) + value.slice(offset),
    cursor: lineStart,
  }
}

export function moveVertical(
  text: string,
  cursor: number,
  direction: 1 | -1,
  preferredColumn: number | null = null,
): VerticalMoveResult {
  const normalized = normalizeCursor(text, cursor)
  const nextColumn = preferredColumn ?? cursorColumn(normalized.value, normalized.offset)
  const moved = moveVerticalCursor(normalized, direction, nextColumn)
  if (moved.moved) {
    return { kind: 'moved', cursor: moved.cursor.offset, preferredColumn: nextColumn }
  }
  return {
    kind: direction === -1 ? 'boundary-top' : 'boundary-bottom',
    cursor: normalized.offset,
    preferredColumn: nextColumn,
  }
}

export function moveVerticalVisual(
  text: string,
  cursor: number,
  direction: 1 | -1,
  wrapWidth: number,
  preferredColumn: number | null = null,
): VerticalMoveResult {
  const normalized = normalizeCursor(text, cursor)
  const position = visualPosition(normalized.value, normalized.offset, wrapWidth)
  const nextColumn = preferredColumn ?? position.column
  const moved = moveVerticalVisualCursor(normalized, direction, wrapWidth, nextColumn)
  if (moved.moved) {
    return { kind: 'moved', cursor: moved.cursor.offset, preferredColumn: nextColumn }
  }
  return {
    kind: direction === -1 ? 'boundary-top' : 'boundary-bottom',
    cursor: normalized.offset,
    preferredColumn: nextColumn,
  }
}

export function detectActiveFileMention(value: string, cursor: number): FileMentionToken | undefined {
  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const left = value.slice(0, safeCursor)
  const atIndex = left.lastIndexOf('@')
  if (atIndex === -1) return undefined
  const before = atIndex === 0 ? '' : value[atIndex - 1]
  if (before && !/\s|\(|\[|\{/.test(before)) return undefined
  const between = value.slice(atIndex + 1, safeCursor)
  if (/\s/.test(between)) return undefined
  let end = safeCursor
  while (end < value.length && !/\s/.test(value[end]!)) end += 1
  return { start: atIndex, end, query: between }
}

export function replaceActiveFileMention(buffer: ChatBuffer, replacementPath: string): ChatBuffer {
  const mention = detectActiveFileMention(buffer.value, buffer.cursor)
  if (!mention) return buffer
  const replacement = `@${replacementPath}`
  const value = buffer.value.slice(0, mention.start) + replacement + buffer.value.slice(mention.end)
  return { value, cursor: mention.start + replacement.length }
}

function visualPosition(value: string, offset: number, wrapWidth: number): { column: number } {
  const lines = getVisualLines(value, wrapWidth)
  for (const entry of lines) {
    if (entry.start === entry.end && offset === entry.start) {
      return { column: 0 }
    }
    if (offset >= entry.start && offset < entry.end) {
      return { column: offset - entry.start }
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const entry = lines[index]!
    if (offset === entry.end) {
      return { column: entry.end - entry.start }
    }
  }

  return { column: 0 }
}

function visualLineStart(value: string, offset: number, wrapWidth: number): number {
  const lines = getVisualLines(value, wrapWidth)
  for (let index = 0; index < lines.length; index += 1) {
    const entry = lines[index]!
    if (entry.start === entry.end && offset === entry.start) return entry.start
    if (offset > entry.start && offset <= entry.end) return entry.start
    if (offset === entry.start) {
      const previous = lines[index - 1]
      if (previous && previous.end === entry.start) return previous.start
      return entry.start
    }
  }

  const last = lines[lines.length - 1]
  return last ? last.start : 0
}
