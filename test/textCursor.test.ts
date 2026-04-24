import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cursorColumn,
  cursorOnLastLineAtColumn,
  getVisibleVisualLineWindow,
  getVisualLineIndex,
  getVisualLines,
  moveVerticalVisualCursor,
  moveVerticalCursor,
  normalizeCursor,
} from '../src/ui/textCursor.js'

test('moveVerticalCursor moves inside a multiline prompt before history boundaries', () => {
  const value = 'aaaaaa\naaaaa'
  const cursor = normalizeCursor(value, value.indexOf('\n') + 1 + 3)

  const moved = moveVerticalCursor(cursor, -1)
  assert.equal(moved.moved, true)
  assert.equal(moved.cursor.offset, 3)

  const boundary = moveVerticalCursor(moved.cursor, -1)
  assert.equal(boundary.moved, false)
  assert.equal(boundary.cursor.offset, 3)
})

test('moveVerticalCursor clamps to uneven line lengths', () => {
  const value = '123456\n12\n1234567'
  const cursor = normalizeCursor(value, value.length)

  const moved = moveVerticalCursor(cursor, -1)
  assert.equal(moved.moved, true)
  assert.equal(cursorColumn(moved.cursor.value, moved.cursor.offset), 2)
})

test('cursorOnLastLineAtColumn restores history drafts on the last line', () => {
  const restored = cursorOnLastLineAtColumn('alpha\nbeta', 3)

  assert.equal(restored.offset, 'alpha\n'.length + 3)
})

test('getVisualLines char-wraps logical lines and preserves empty rows', () => {
  assert.deepEqual(getVisualLines('abcdef\ng\n', 3), [
    { start: 0, end: 3 },
    { start: 3, end: 6 },
    { start: 7, end: 8 },
    { start: 9, end: 9 },
  ])
})

test('getVisualLineIndex finds the cursor visual row at wrap boundaries', () => {
  const lines = getVisualLines('abcdefgh', 4)

  assert.equal(getVisualLineIndex(lines, 0), 0)
  assert.equal(getVisualLineIndex(lines, 3), 0)
  assert.equal(getVisualLineIndex(lines, 4), 1)
  assert.equal(getVisualLineIndex(lines, 8), 2)
})

test('getVisibleVisualLineWindow centers the cursor when possible', () => {
  assert.deepEqual(getVisibleVisualLineWindow(10, 5, 5), { start: 3, end: 8 })
})

test('getVisibleVisualLineWindow clamps near top and bottom', () => {
  assert.deepEqual(getVisibleVisualLineWindow(10, 0, 5), { start: 0, end: 5 })
  assert.deepEqual(getVisibleVisualLineWindow(10, 9, 5), { start: 5, end: 10 })
})

test('getVisibleVisualLineWindow shows all rows when under the cap', () => {
  assert.deepEqual(getVisibleVisualLineWindow(3, 2, 5), { start: 0, end: 3 })
})

test('moveVerticalVisualCursor moves between soft-wrapped visual rows', () => {
  const value = 'abcdefghijkl'
  const cursor = normalizeCursor(value, 10)

  const moved = moveVerticalVisualCursor(cursor, -1, 4)
  assert.equal(moved.moved, true)
  assert.equal(moved.cursor.offset, 6)

  const movedAgain = moveVerticalVisualCursor(moved.cursor, -1, 4, 2)
  assert.equal(movedAgain.moved, true)
  assert.equal(movedAgain.cursor.offset, 2)
})

test('moveVerticalVisualCursor reports boundaries across hard-newline and soft-wrap mix', () => {
  const value = 'abcd\nef'
  const atTop = normalizeCursor(value, 2)
  const topBoundary = moveVerticalVisualCursor(atTop, -1, 4)

  assert.equal(topBoundary.moved, false)
  assert.equal(topBoundary.cursor.offset, 2)

  const atBottom = normalizeCursor(value, value.length)
  const bottomBoundary = moveVerticalVisualCursor(atBottom, 1, 4)
  assert.equal(bottomBoundary.moved, false)
  assert.equal(bottomBoundary.cursor.offset, value.length)
})
