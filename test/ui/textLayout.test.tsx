import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import {
  cleanTypedText,
  layoutTextRows,
  moveAcrossRows,
  nextCharBoundary,
  prevCharBoundary,
  truncateEnd,
  wrapWords,
} from '../../src/ui/text.js'
import { TextArea, textAreaWidth } from '../../src/ui/TextArea.js'
import { inputViewport } from '../../src/ui/TextInput.js'
import { Select } from '../../src/ui/Select.js'
import { TerminalSizeProvider } from '../../src/ui/layout.js'
import { FlowTimeline, segmentWidths } from '../../src/identity/manager/shared/components/FlowTimeline.js'

const COLUMNS = 54
const CONTENT_WIDTH = 42
const SENTENCE = 'Ships small terminal tools, keeps careful notes on every release, and explains tradeoffs plainly before touching anything irreversible.'

const ESC = String.fromCharCode(27)
const stripAnsi = (value: string): string => value.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '')
const noop = (): void => {}

function plainLines(node: React.ReactElement): string[] {
  const { lastFrame, unmount } = render(<TerminalSizeProvider columns={COLUMNS}>{node}</TerminalSizeProvider>)
  try {
    return stripAnsi(lastFrame() ?? '').split('\n')
  } finally {
    unmount()
  }
}

test('layoutTextRows breaks only at spaces and keeps every row inside the width', () => {
  const rows = layoutTextRows(SENTENCE, 30)
  assert.ok(rows.length >= 4)
  const pieces = rows.map(row => SENTENCE.slice(row.start, row.end))
  for (const piece of pieces) assert.ok(piece.length <= 30, `row too wide: ${JSON.stringify(piece)}`)
  assert.equal(pieces.join(' '), SENTENCE, 'rows must split the text at word boundaries only')
  rows.forEach((row, index) => {
    const following = rows[index + 1]
    assert.equal(row.next, following ? following.start : SENTENCE.length)
    assert.equal(row.last, !following)
  })
})

test('layoutTextRows maps leading spaces, blank lines, and hard breaks back to offsets', () => {
  const value = '  indented start\n\nsupercalifragilisticexpialidocious'
  const rows = layoutTextRows(value, 10)
  assert.equal(rows[0]!.start, 0, 'leading spaces belong to the first row')
  const blank = rows.find(row => row.start === value.indexOf('\n\n') + 1)
  assert.ok(blank && blank.start === blank.end && blank.last, 'an empty line is its own empty row')
  const longWordRows = rows.filter(row => row.start >= value.lastIndexOf('\n') + 1)
  assert.equal(longWordRows.map(row => value.slice(row.start, row.end)).join(''), 'supercalifragilisticexpialidocious')
  for (const row of longWordRows) assert.ok(row.end - row.start <= 10)
})

test('moveAcrossRows walks visual rows and clamps to the shorter row', () => {
  const value = 'alpha beta gamma delta'
  const rows = layoutTextRows(value, 11)
  assert.deepEqual(rows.map(row => value.slice(row.start, row.end)), ['alpha beta', 'gamma delta'])
  const down = moveAcrossRows(rows, 3, 1)
  assert.equal(down, rows[1]!.start + 3)
  assert.equal(moveAcrossRows(rows, down, -1), 3)
  assert.equal(moveAcrossRows(rows, 2, -1), 2, 'up on the first row stays put')
  assert.equal(moveAcrossRows(rows, value.length, 1), value.length, 'down on the last row stays put')
  assert.equal(moveAcrossRows(rows, value.length, -1), rows[0]!.next - 1, 'a long column clamps to the end of the shorter row')
})

test('cursor helpers step over surrogate pairs and typed text drops control bytes', () => {
  const value = 'a🐱b'
  assert.equal(nextCharBoundary(value, 1), 3)
  assert.equal(prevCharBoundary(value, 3), 1)
  assert.equal(prevCharBoundary(value, 0), 0)
  assert.equal(cleanTypedText('one\ttwo\r\nthree\u0007', true), 'one two\nthree')
  assert.equal(cleanTypedText('one\ntwo', false), 'onetwo')
})

test('wrapWords keeps words whole and collapses runs of whitespace', () => {
  assert.deepEqual(wrapWords('alpha   beta gamma', 11), ['alpha beta', 'gamma'])
  assert.deepEqual(wrapWords('first\n\nsecond', 20), ['first', '', 'second'])
})

test('truncateEnd shortens with an ellipsis and leaves short text alone', () => {
  assert.equal(truncateEnd('short', 10), 'short')
  assert.equal(truncateEnd('Release Notes Assistant', 12), 'Release Not…')
  assert.equal(truncateEnd('Release Notes', 9), 'Release…')
})

test('textarea wraps a description at word boundaries inside the panel', () => {
  const lines = plainLines(<TextArea initialValue={SENTENCE} onSubmit={noop} />)
  const rows = lines.filter(line => line.trim().length > 0).map(line => line.slice(2).trimEnd())
  assert.ok(rows.length >= 3)
  for (const line of lines) assert.ok(line.length <= textAreaWidth(COLUMNS) + 2, `row exceeds the editor width: ${JSON.stringify(line)}`)
  assert.equal(rows.join(' '), SENTENCE, 'no word may be split across rows')
  assert.ok(lines.some(line => line.startsWith('> ')), 'the cursor row keeps its marker')
})

test('textarea keeps a typed trailing space visible before the cursor', () => {
  const lines = plainLines(<TextArea initialValue="hello " onSubmit={noop} />)
  const cursorRow = lines.find(line => line.startsWith('> '))
  assert.ok(cursorRow)
  assert.equal(cursorRow!.slice(2).trimEnd(), 'hello', 'the space and cursor cell sit after the word')
  assert.ok(cursorRow!.slice(2).startsWith('hello  '), 'the cursor sits one cell past the typed space')
})

test('inputViewport keeps the cursor visible on long single-line values', () => {
  const value = 'x'.repeat(80)
  const end = inputViewport(value, value.length, 20)
  assert.equal(end.under, ' ')
  assert.ok(end.before.startsWith('…'))
  assert.ok(end.before.length + 1 + end.after.length <= 20)
  const start = inputViewport(value, 0, 20)
  assert.equal(start.before, '')
  assert.ok(start.after.endsWith('…'))
  assert.ok(start.before.length + 1 + start.after.length <= 20)
  const short = inputViewport('agent', 2, 20)
  assert.deepEqual(short, { before: 'ag', under: 'e', after: 'nt' })
})

test('select truncates an overlong label to one line instead of wrapping', () => {
  const lines = plainLines(
    <Select<string>
      options={[
        { value: 'long', label: 'Release Notes Assistant for the Northwind Platform Team' },
        { value: 'back', label: 'Back', role: 'utility' },
      ]}
      onSubmit={noop}
    />,
  )
  const row = lines.find(line => line.includes('Release'))
  assert.ok(row && row.includes('…'), 'the long label must end in an ellipsis')
  assert.ok(row!.trimEnd().length <= CONTENT_WIDTH)
  assert.ok(!lines.some(line => line.includes('Platform Team')), 'the label must not spill onto a second row')
})

test('flow timeline renders a segmented track with its count inside the panel', () => {
  const [line] = plainLines(<FlowTimeline steps={['Name', 'Describe', 'Network', 'Custody', 'Create']} current={2} />)
  assert.ok(line)
  assert.ok(line!.trimEnd().length <= CONTENT_WIDTH)
  assert.match(line!, /^━+ ━+ ─+ ─+ ─+ {2}2 of 5/)
  assert.deepEqual(segmentWidths(5, 34), [6, 6, 6, 6, 6])
  assert.equal(segmentWidths(3, 20).reduce((sum, width) => sum + width, 0) + 2, 20)
})
