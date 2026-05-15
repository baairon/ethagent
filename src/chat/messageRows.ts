import type { RowSlice } from './transcript/transcriptViewport.js'
import type { MessageRow } from './MessageList.js'

export function rowsToFullSlices(rows: MessageRow[]): Array<RowSlice<MessageRow>> {
  return rows.map(row => ({ row, clipStart: 0, clipEnd: Number.MAX_SAFE_INTEGER, rowHeight: Number.MAX_SAFE_INTEGER }))
}

export function toggleLatestReasoningRow(rows: MessageRow[]): MessageRow[] {
  return toggleInspectableRow(rows)
}

export function toggleReasoningRow(rows: MessageRow[], rowId?: string): MessageRow[] {
  return toggleInspectableRow(rows, rowId)
}

export function toggleInspectableRow(rows: MessageRow[], rowId?: string): MessageRow[] {
  let index = -1
  if (rowId) {
    index = rows.findIndex(row => row.id === rowId && isInspectableRole(row.role))
  }
  if (index === -1) {
    for (let cursor = rows.length - 1; cursor >= 0; cursor -= 1) {
      const role = rows[cursor]?.role
      if (role && isInspectableRole(role)) {
        index = cursor
        break
      }
    }
  }
  if (index === -1) return rows
  const row = rows[index]
  if (!row) return rows
  if (row.role === 'thinking') {
    const next = rows.slice()
    next[index] = { ...row, expanded: !row.expanded }
    return next
  }
  return rows
}

function isInspectableRole(role: MessageRow['role']): boolean {
  return role === 'thinking'
}
