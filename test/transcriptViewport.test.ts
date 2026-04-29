import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorForScrollTop,
  buildLineOffsets,
  estimateMessageRowHeight,
  promptScrollTopForPageDown,
  promptScrollTopForPageUp,
  resolveScrollTopFromAnchor,
  selectRowsForScrollOffset,
  selectRowsForScrollTop,
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

test('transcript viewport scroll offset pages back from the live tail', () => {
  const rows = [
    { id: 'a', value: 'oldest' },
    { id: 'b', value: 'middle' },
    { id: 'c', value: 'latest' },
  ]

  const tail = selectRowsForScrollOffset(rows, 4, 0, () => 2)
  assert.deepEqual(tail.rows.map(row => row.id), ['b', 'c'])
  assert.equal(tail.hiddenBefore, 1)
  assert.equal(tail.hiddenAfter, 0)

  const pageUp = selectRowsForScrollOffset(rows, 4, 2, () => 2)
  assert.deepEqual(pageUp.rows.map(row => row.id), ['a', 'b'])
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

  assert.deepEqual(selected.rows.map(row => row.id), ['a', 'b'])
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

test('transcript viewport page up hops to the latest prompt from the tail', () => {
  const rows: MessageRow[] = [
    { role: 'user', id: 'u1', content: 'one' },
    { role: 'assistant', id: 'a1', content: 'answer one' },
    { role: 'user', id: 'u2', content: 'two' },
    { role: 'assistant', id: 'a2', content: 'answer two' },
  ]
  const offsets = buildLineOffsets([1, 3, 1, 3])

  assert.equal(promptScrollTopForPageUp(rows, offsets, 4, 4, true), 4)
})

test('transcript viewport page keys hop between prompt starts and tail', () => {
  const rows: MessageRow[] = [
    { role: 'user', id: 'u1', content: 'one' },
    { role: 'assistant', id: 'a1', content: 'answer one' },
    { role: 'user', id: 'u2', content: 'two' },
    { role: 'assistant', id: 'a2', content: 'answer two' },
    { role: 'user', id: 'u3', content: 'three' },
    { role: 'assistant', id: 'a3', content: 'answer three' },
  ]
  const offsets = buildLineOffsets([1, 3, 1, 3, 1, 3])

  assert.equal(promptScrollTopForPageUp(rows, offsets, 8, 8, false), 4)
  assert.equal(promptScrollTopForPageDown(rows, offsets, 4, 8), 8)
  assert.equal(promptScrollTopForPageDown(rows, offsets, 8, 8), 8)
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
