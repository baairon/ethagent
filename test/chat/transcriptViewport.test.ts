import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorForScrollTop,
  buildLineOffsets,
  estimateMessageRowHeight,
  resolveScrollTopFromAnchor,
  scrollTopForPageDown,
  scrollTopForPageUp,
  selectRowsForScrollOffset,
  selectRowsForScrollTop,
  selectTailRowsForViewport,
} from '../../src/chat/transcript/transcriptViewport.js'
import type { MessageRow } from '../../src/chat/MessageList.js'

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

  assert.deepEqual(selected.rows.map(slice => slice.row.id), ['b', 'c'])
  assert.equal(selected.hiddenCount, 1)
})

test('transcript viewport always keeps at least the newest row', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'large latest' },
  ]
  const selected = selectTailRowsForViewport(rows, 1, row => row.id === 'b' ? 20 : 1)

  assert.deepEqual(selected.rows.map(slice => slice.row.id), ['b'])
  assert.equal(selected.hiddenCount, 1)
})

test('transcript viewport scroll offset pages back from the live tail', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'middle' },
    { id: 'c', value: 'latest' },
  ]

  const tail = selectRowsForScrollOffset(rows, 4, 0, () => 2)
  assert.deepEqual(tail.rows.map(slice => slice.row.id), ['b', 'c'])
  assert.equal(tail.hiddenBefore, 1)
  assert.equal(tail.hiddenAfter, 0)

  const pageUp = selectRowsForScrollOffset(rows, 4, 2, () => 2)
  assert.deepEqual(pageUp.rows.map(slice => slice.row.id), ['a', 'b'])
  assert.equal(pageUp.hiddenBefore, 0)
  assert.equal(pageUp.hiddenAfter, 1)
  assert.equal(pageUp.maxScrollOffset, 2)
})

test('transcript viewport selects rows from an absolute scroll top', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'middle' },
    { id: 'c', value: 'latest' },
  ]

  const selected = selectRowsForScrollTop(rows, 4, 0, () => 2)

  assert.deepEqual(selected.rows.map(slice => slice.row.id), ['a', 'b'])
  assert.equal(selected.hiddenBefore, 0)
  assert.equal(selected.hiddenAfter, 1)
  assert.equal(selected.maxScrollOffset, 2)
})

test('transcript viewport anchor keeps position when newer rows arrive', () => {
  const beforeRows = ['a', 'b', 'c']
  const beforeOffsets = buildLineOffsets([2, 2, 2])
  const anchor = anchorForScrollTop(beforeRows, beforeOffsets, 2)

  const afterRows = ['a', 'b', 'c', 'd']
  const afterOffsets = buildLineOffsets([2, 2, 2, 2])

  assert.deepEqual(anchor, { rowId: 'b', offset: 0 })
  assert.equal(resolveScrollTopFromAnchor(afterRows, afterOffsets, anchor, 4), 2)
})

test('transcript viewport anchor keeps reasoning row stable when it expands', () => {
  const ids = ['intro', 'reasoning', 'tail']
  const beforeOffsets = buildLineOffsets([2, 3, 2])
  const anchor = anchorForScrollTop(ids, beforeOffsets, 2)
  const afterOffsets = buildLineOffsets([2, 8, 2])

  assert.deepEqual(anchor, { rowId: 'reasoning', offset: 0 })
  assert.equal(resolveScrollTopFromAnchor(ids, afterOffsets, anchor, 8), 2)
})

test('transcript viewport page up moves almost a full viewport from the tail', () => {
  assert.equal(scrollTopForPageUp(8, 8, 8), 2)
  assert.equal(scrollTopForPageUp(2, 8, 8), 0)
  assert.equal(scrollTopForPageUp(1, 8, 8), 0)
})

test('transcript viewport page down moves almost a full viewport and clamps to tail', () => {
  assert.equal(scrollTopForPageDown(0, 8, 8), 6)
  assert.equal(scrollTopForPageDown(6, 8, 8), 8)
  assert.equal(scrollTopForPageDown(8, 8, 8), 8)
})

test('transcript viewport page keys use viewport lines instead of prompt starts', () => {
  assert.equal(scrollTopForPageUp(15, 20, 7), 10)
  assert.equal(scrollTopForPageDown(10, 20, 7), 15)
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

test('viewport clips a tall row to the visible line range', () => {
  const rows = [
    { id: 'a', value: 'tall row' },
  ]
  const selected = selectRowsForScrollTop(rows, 5, 3, () => 20)
  assert.equal(selected.rows.length, 1)
  assert.equal(selected.rows[0]!.row.id, 'a')
  assert.equal(selected.rows[0]!.clipStart, 3)
  assert.equal(selected.rows[0]!.clipEnd, 8)
  assert.equal(selected.rows[0]!.rowHeight, 20)
})

test('viewport clips edges when window straddles two rows', () => {
  const rows = [
    { id: 'a', value: 'first' },
    { id: 'b', value: 'second' },
  ]
  const selected = selectRowsForScrollTop(rows, 6, 4, () => 10)
  assert.equal(selected.rows.length, 2)
  assert.equal(selected.rows[0]!.row.id, 'a')
  assert.equal(selected.rows[0]!.clipStart, 4)
  assert.equal(selected.rows[0]!.clipEnd, 10)
  assert.equal(selected.rows[1]!.row.id, 'b')
  assert.equal(selected.rows[1]!.clipStart, 0)
  assert.equal(selected.rows[1]!.clipEnd, 10)
})

test('viewport tail selection reports each row clipped at full height', () => {
  const rows = [
    { id: 'a', value: 'first' },
    { id: 'b', value: 'second' },
  ]
  const selected = selectTailRowsForViewport(rows, 5, () => 2)
  assert.equal(selected.rows.length, 2)
  selected.rows.forEach(slice => {
    assert.equal(slice.clipStart, 0)
    assert.equal(slice.clipEnd, slice.rowHeight)
  })
})
