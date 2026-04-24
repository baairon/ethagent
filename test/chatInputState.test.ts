import test from 'node:test'
import assert from 'node:assert/strict'
import {
  beginHistoryPreview,
  canNavigateHistory,
  deleteToLineStart,
  detectActiveFileMention,
  moveThroughHistory,
  moveVertical,
  moveVerticalVisual,
  replaceActiveFileMention,
  type ChatBuffer,
} from '../src/ui/chatInputState.js'

test('deleteToLineStart removes only the current logical line prefix', () => {
  const value = 'first line\nsecond line suffix'
  const cursor = 'first line\nsecond'.length
  const next = deleteToLineStart({ value, cursor }, 80)

  assert.deepEqual(next, {
    value: 'first line\n line suffix',
    cursor: 'first line\n'.length,
  })
})

test('deleteToLineStart deletes the previous newline when repeated at line start', () => {
  const value = 'first\nsecond'
  const cursor = 'first\n'.length
  const next = deleteToLineStart({ value, cursor }, 80)

  assert.deepEqual(next, {
    value: 'firstsecond',
    cursor: 'first'.length,
  })
})

test('deleteToLineStart respects visual soft-wrap boundaries', () => {
  const value = 'abcdefghijkl'
  const next = deleteToLineStart({ value, cursor: 10 }, 4)

  assert.deepEqual(next, {
    value: 'abcdefghkl',
    cursor: 8,
  })
})

test('deleteToLineStart deletes the previous visual row at a wrap boundary', () => {
  const value = 'abcdefghijkl'
  const next = deleteToLineStart({ value, cursor: 8 }, 4)

  assert.deepEqual(next, {
    value: 'abcdijkl',
    cursor: 4,
  })
})

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

test('moveVerticalVisual preserves preferred column across soft wraps', () => {
  const value = 'abcdefghijkl'
  const movedUp = moveVerticalVisual(value, 10, -1, 4)

  assert.equal(movedUp.kind, 'moved')
  if (movedUp.kind !== 'moved') return
  assert.equal(movedUp.preferredColumn, 2)
  assert.equal(movedUp.cursor, 6)

  const movedUpAgain = moveVerticalVisual(value, movedUp.cursor, -1, 4, movedUp.preferredColumn)
  assert.equal(movedUpAgain.kind, 'moved')
  if (movedUpAgain.kind !== 'moved') return
  assert.equal(movedUpAgain.cursor, 2)
})

test('moveVerticalVisual handles hard-newline and soft-wrap mix', () => {
  const value = 'abcd\nefghij'
  const moved = moveVerticalVisual(value, value.length, -1, 4)

  assert.equal(moved.kind, 'moved')
  if (moved.kind !== 'moved') return
  assert.equal(moved.cursor, 7)

  const movedAgain = moveVerticalVisual(value, moved.cursor, -1, 4, moved.preferredColumn)
  assert.equal(movedAgain.kind, 'moved')
  if (movedAgain.kind !== 'moved') return
  assert.equal(movedAgain.cursor, 2)
})

test('moveVerticalVisual reports top and bottom boundaries', () => {
  const value = 'abc'
  const top = moveVerticalVisual(value, 1, -1, 20)
  const bottom = moveVerticalVisual(value, 1, 1, 20)

  assert.equal(top.kind, 'boundary-top')
  assert.equal(top.cursor, 1)
  assert.equal(bottom.kind, 'boundary-bottom')
  assert.equal(bottom.cursor, 1)
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

test('beginHistoryPreview places the cursor at the end of the newest history item', () => {
  const buffer: ChatBuffer = { value: 'draft one\ndraft two', cursor: 2 }
  const history = ['older prompt', 'alpha\nbeta']
  const preview = beginHistoryPreview(buffer, history, -1, 4)

  assert.ok(preview)
  if (!preview) return
  assert.equal(preview.preview.historyIndex, 1)
  assert.equal(preview.preview.preferredColumn, null)
  assert.deepEqual(preview.buffer, { value: 'alpha\nbeta', cursor: 'alpha\nbeta'.length })
})

test('moveThroughHistory restores the draft with the cursor at the end when leaving preview', () => {
  const draftBuffer: ChatBuffer = { value: 'alpha\nbeta', cursor: 2 }
  const history = ['older prompt', 'newer\nprompt']
  const restored = moveThroughHistory(history, 1, 1, draftBuffer, 3)

  assert.equal(restored.preview.historyIndex, null)
  assert.equal(restored.preview.historyPreviewActive, false)
  assert.equal(restored.preview.preferredColumn, null)
  assert.deepEqual(restored.buffer, { value: draftBuffer.value, cursor: draftBuffer.value.length })
})

test('moveThroughHistory restores the current draft when cycling down from newest history', () => {
  const draftBuffer: ChatBuffer = { value: 'current draft', cursor: 4 }
  const history = ['older prompt', 'newest prompt']
  const restored = moveThroughHistory(history, 1, 1, draftBuffer, null)

  assert.equal(restored.preview.historyIndex, null)
  assert.equal(restored.preview.historyPreviewActive, false)
  assert.deepEqual(restored.buffer, { value: 'current draft', cursor: 'current draft'.length })
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
  assert.deepEqual(newer.buffer, { value: draftBuffer.value, cursor: draftBuffer.value.length })
})

test('moveThroughHistory places the cursor at the end of every selected history entry', () => {
  const draftBuffer: ChatBuffer = { value: 'draft', cursor: 1 }
  const history = ['older prompt', 'middle\nprompt', 'newest']

  const preview = beginHistoryPreview(draftBuffer, history, -1, null)
  assert.ok(preview)
  if (!preview) return
  assert.deepEqual(preview.buffer, { value: 'newest', cursor: 'newest'.length })

  const older = moveThroughHistory(history, preview.preview.historyIndex!, -1, draftBuffer, preview.preview.preferredColumn)
  assert.deepEqual(older.buffer, { value: 'middle\nprompt', cursor: 'middle\nprompt'.length })
})

test('detectActiveFileMention finds the token at the cursor', () => {
  const value = 'read @../notes'
  const mention = detectActiveFileMention(value, value.length)

  assert.deepEqual(mention, {
    start: 5,
    end: value.length,
    query: '../notes',
  })
})

test('replaceActiveFileMention replaces only the active mention token', () => {
  const buffer: ChatBuffer = { value: 'read @src/ind please', cursor: 'read @src/ind'.length }
  const replaced = replaceActiveFileMention(buffer, 'src/index.html')

  assert.deepEqual(replaced, {
    value: 'read @src/index.html please',
    cursor: 'read @src/index.html'.length,
  })
})
