import test from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorForScrollTop,
  buildLineOffsets,
  resolveScrollTopFromAnchor,
} from '../src/ui/transcriptViewport.js'

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