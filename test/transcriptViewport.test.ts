import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorForScrollTop,
  buildLineOffsets,
  estimateMessageRowHeight,
  resolveScrollTopFromAnchor,
  selectTailRowsForViewport,
} from '../src/ui/transcriptViewport.js'
import type { MessageRow } from '../src/ui/MessageList.js'

test('transcript viewport anchor preserves the same row through height changes', () => {
  const ids = ['a', 'b', 'c']
  const before = buildLineOffsets([3, 5, 4])
  const anchor = anchorForScrollTop(ids, before, 4)

  assert.deepEqual(anchor, { rowId: 'b', offset: 1 })

  const after = buildLineOffsets([8, 5, 4])
  const resolved = resolveScrollTopFromAnchor(ids, after, anchor, 20)

  assert.equal(resolved, 9)
})

test('transcript viewport anchor clamps when content shrinks', () => {
  const ids = ['a', 'b']
  const before = buildLineOffsets([10, 10])
  const anchor = anchorForScrollTop(ids, before, 15)
  const after = buildLineOffsets([2, 2])

  assert.equal(resolveScrollTopFromAnchor(ids, after, anchor, 1), 1)
})

test('transcript viewport selects only the tail rows within the render budget', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'middle' },
    { id: 'c', value: 'latest' },
  ]
  const selected = selectTailRowsForViewport(rows, 5, row => row.id === 'c' ? 3 : 2)

  assert.deepEqual(selected.rows.map(row => row.id), ['b', 'c'])
  assert.equal(selected.hiddenCount, 1)
})

test('transcript viewport always keeps at least the newest row', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'large latest' },
  ]
  const selected = selectTailRowsForViewport(rows, 1, row => row.id === 'b' ? 20 : 1)

  assert.deepEqual(selected.rows.map(row => row.id), ['b'])
  assert.equal(selected.hiddenCount, 1)
})

test('message row height estimate accounts for wrapped transcript content', () => {
  const row: MessageRow = { role: 'assistant', id: 'a', content: 'a'.repeat(30), liveTail: 'b'.repeat(25) }

  assert.equal(estimateMessageRowHeight(row, 32), 5)
})

test('expanded reasoning rows account for full content height', () => {
  const collapsed: MessageRow = { role: 'thinking', id: 't', content: 'a'.repeat(180), expanded: false }
  const expanded: MessageRow = { ...collapsed, expanded: true }

  const collapsedHeight = estimateMessageRowHeight(collapsed, 32)
  assert.ok(collapsedHeight > 2)
  assert.ok(estimateMessageRowHeight(expanded, 32) > collapsedHeight)
})
