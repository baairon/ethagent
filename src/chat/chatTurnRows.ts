import type { MessageRow } from './MessageList.js'

export function updateStreamingRows(
  rows: MessageRow[],
  assistantId: string | null,
  thinkingRowId: string | null,
  assistantText: string | null,
  thinkingText: string | null,
): MessageRow[] {
  let next: MessageRow[] | null = null
  if (assistantId && assistantText !== null) {
    const index = findRowIndexById(rows, assistantId)
    const row = rows[index]
    if (row?.role === 'assistant') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: assistantText, liveTail: '' }
    }
  }
  const source = next ?? rows
  if (thinkingRowId && thinkingText !== null) {
    const index = findRowIndexById(source, thinkingRowId)
    const row = source[index]
    if (row?.role === 'thinking') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: thinkingText, liveTail: '' }
    }
  }
  return next ?? rows
}

export function finalizeStreamingRowsById(
  rows: MessageRow[],
  assistantId: string | null,
  thinkingRowId: string | null,
  assistantText: string,
  thinkingText: string,
): MessageRow[] {
  let next: MessageRow[] | null = null
  if (assistantId) {
    const index = findRowIndexById(rows, assistantId)
    const row = rows[index]
    if (row?.role === 'assistant') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: assistantText || row.content, liveTail: undefined, streaming: false }
    }
  }
  const source = next ?? rows
  if (thinkingRowId) {
    const index = findRowIndexById(source, thinkingRowId)
    const row = source[index]
    if (row?.role === 'thinking') {
      next = next ?? rows.slice()
      next[index] = { ...row, content: thinkingText || row.content, liveTail: undefined, streaming: false, showCursor: false }
    }
  }
  return next ?? rows
}

function findRowIndexById(rows: MessageRow[], id: string): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.id === id) return index
  }
  return -1
}
