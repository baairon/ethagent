import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beginHistoryPreview,
  bufferFromLastLine,
  canNavigateHistory,
  moveThroughHistory,
  moveVertical,
  type ChatBuffer,
} from '../src/ui/chatInputState.js'

test('moveVertical preserves the preferred column across multiline hops', () => {
  const value = '12345\n12\n123456'
  const startCursor = value.length

  const movedUp = moveVertical(value, startCursor, -1)
  assert.equal(movedUp.kind, 'moved')
  if (movedUp.kind !== 'moved') return
  assert.equal(movedUp.preferredColumn, 6)
  assert.equal(movedUp.cursor, 8)

  const movedUpAgain = moveVertical(value, movedUp.cursor, -1, movedUp.preferredColumn)
  assert.equal(movedUpAgain.kind, 'moved')
  if (movedUpAgain.kind !== 'moved') return
  assert.equal(movedUpAgain.cursor, 5)
})

test('moveVertical reports the top boundary for multiline history entry', () => {
  const value = 'first line\nsecond line'
  const atTop = moveVertical(value, 3, -1)

  assert.equal(atTop.kind, 'boundary-top')
  assert.equal(atTop.preferredColumn, 3)
})

test('moveVertical from the second line moves into the first line before any history boundary', () => {
  const value = 'aaaaaaa\naaaaaa'
  const secondLineCursor = value.indexOf('\n') + 1 + 4
  const moved = moveVertical(value, secondLineCursor, -1)

  assert.equal(moved.kind, 'moved')
  if (moved.kind !== 'moved') return
  assert.equal(moved.cursor, 4)

  const crossedTop = moveVertical(value, moved.cursor, -1, moved.preferredColumn)
  assert.equal(crossedTop.kind, 'boundary-top')
})

test('history remains reachable from a non-empty multiline prompt', () => {
  const buffer: ChatBuffer = { value: 'aaaaaa\naaaaa', cursor: 6 }

  assert.equal(canNavigateHistory(buffer, 3, null, false), true)
})

test('beginHistoryPreview enters on the last line of the newest history item', () => {
  const buffer: ChatBuffer = { value: 'draft one\ndraft two', cursor: 2 }
  const history = ['older prompt', 'alpha\nbeta']
  const preview = beginHistoryPreview(buffer, history, -1, 4)

  assert.ok(preview)
  if (!preview) return
  assert.equal(preview.preview.historyIndex, 1)
  assert.equal(preview.preview.preferredColumn, 4)
  assert.deepEqual(preview.buffer, bufferFromLastLine('alpha\nbeta', 4))
})

test('moveThroughHistory restores the draft on its last line when leaving preview', () => {
  const draftBuffer: ChatBuffer = { value: 'alpha\nbeta', cursor: 2 }
  const history = ['older prompt', 'newer\nprompt']
  const restored = moveThroughHistory(history, 1, 1, draftBuffer, 3)

  assert.equal(restored.preview.historyIndex, null)
  assert.equal(restored.preview.historyPreviewActive, false)
  assert.equal(restored.preview.preferredColumn, 3)
  assert.deepEqual(restored.buffer, bufferFromLastLine(draftBuffer.value, 3))
})

test('moveThroughHistory walks back down to the draft instead of trapping on history', () => {
  const draftBuffer: ChatBuffer = { value: 'aaaaaa\naaaaa', cursor: 6 }
  const history = ['oldest', 'middle', 'newest']

  const preview = beginHistoryPreview(draftBuffer, history, -1, 4)
  assert.ok(preview)
  if (!preview) return

  const newer = moveThroughHistory(history, preview.preview.historyIndex!, 1, preview.preview.draftBuffer, preview.preview.preferredColumn)
  assert.equal(newer.preview.historyIndex, null)
  assert.equal(newer.preview.historyPreviewActive, false)
  assert.deepEqual(newer.buffer, bufferFromLastLine(draftBuffer.value, 4))
})
