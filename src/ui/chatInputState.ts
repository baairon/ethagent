export type ChatBuffer = {
  value: string
  cursor: number
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
  return { value, cursor }
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
  preferredColumn: number | null,
): { preview: HistoryPreviewState; buffer: ChatBuffer } | null {
  if (history.length === 0) return null
  const nextIndex = direction === -1 ? history.length - 1 : 0
  const chosen = history[nextIndex] ?? ''
  const nextColumn = preferredColumn ?? getCursorColumn(buffer.value, buffer.cursor)
  return {
    preview: {
      historyIndex: nextIndex,
      historyPreviewActive: true,
      draftBuffer: buffer,
      preferredColumn: nextColumn,
    },
    buffer: bufferFromLastLine(chosen, nextColumn),
  }
}

export function moveThroughHistory(
  history: string[],
  historyIndex: number,
  direction: 1 | -1,
  draftBuffer: ChatBuffer,
  preferredColumn: number | null,
): { preview: HistoryPreviewState; buffer: ChatBuffer } {
  const nextColumn = preferredColumn ?? getCursorColumn(draftBuffer.value, draftBuffer.cursor)
  const next = historyIndex + direction
  if (next < 0) {
    const chosen = history[0] ?? ''
    return {
      preview: {
        historyIndex: 0,
        historyPreviewActive: true,
        draftBuffer,
        preferredColumn: nextColumn,
      },
      buffer: bufferFromLastLine(chosen, nextColumn),
    }
  }
  if (next >= history.length) {
    return {
      preview: {
        historyIndex: null,
        historyPreviewActive: false,
        draftBuffer,
        preferredColumn: nextColumn,
      },
      buffer: bufferFromLastLine(draftBuffer.value, nextColumn),
    }
  }
  const chosen = history[next] ?? ''
  return {
    preview: {
      historyIndex: next,
      historyPreviewActive: true,
      draftBuffer,
      preferredColumn: nextColumn,
    },
    buffer: bufferFromLastLine(chosen, nextColumn),
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

export function moveVertical(
  text: string,
  cursor: number,
  direction: 1 | -1,
  preferredColumn: number | null = null,
): VerticalMoveResult {
  const lineInfo = getLineInfo(text, cursor)
  const nextColumn = preferredColumn ?? lineInfo.column

  if (direction === -1) {
    if (lineInfo.lineIndex === 0) {
      return { kind: 'boundary-top', cursor, preferredColumn: nextColumn }
    }
    return {
      kind: 'moved',
      cursor: cursorForLineAndColumn(text, lineInfo.lineIndex - 1, nextColumn),
      preferredColumn: nextColumn,
    }
  }

  if (lineInfo.lineIndex === lineInfo.lineCount - 1) {
    return { kind: 'boundary-bottom', cursor, preferredColumn: nextColumn }
  }

  return {
    kind: 'moved',
    cursor: cursorForLineAndColumn(text, lineInfo.lineIndex + 1, nextColumn),
    preferredColumn: nextColumn,
  }
}

export function bufferFromLastLine(value: string, preferredColumn: number | null = null): ChatBuffer {
  const lineCount = getLineStartOffsets(value).length
  const cursor = cursorForLineAndColumn(value, Math.max(0, lineCount - 1), preferredColumn ?? 0)
  return { value, cursor }
}

function getLineInfo(text: string, cursor: number): { lineIndex: number; lineCount: number; column: number } {
  const starts = getLineStartOffsets(text)
  let lineIndex = 0
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0
    const nextStart = starts[index + 1] ?? text.length + 1
    if (cursor >= start && cursor < nextStart) {
      lineIndex = index
      break
    }
    if (index === starts.length - 1) {
      lineIndex = index
    }
  }
  const lineStart = starts[lineIndex] ?? 0
  return {
    lineIndex,
    lineCount: starts.length,
    column: Math.max(0, cursor - lineStart),
  }
}

function getCursorColumn(text: string, cursor: number): number {
  return getLineInfo(text, cursor).column
}

function cursorForLineAndColumn(text: string, lineIndex: number, preferredColumn: number): number {
  const starts = getLineStartOffsets(text)
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, starts.length - 1))
  const lineStart = starts[boundedLineIndex] ?? 0
  const nextStart = starts[boundedLineIndex + 1] ?? text.length + 1
  const lineEnd = Math.max(lineStart, nextStart - 1)
  const lineLength = Math.max(0, lineEnd - lineStart)
  return lineStart + Math.min(Math.max(0, preferredColumn), lineLength)
}

function getLineStartOffsets(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}
