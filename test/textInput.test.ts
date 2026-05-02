import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { Box, Text, renderToString } from 'ink'
import {
  renderTextInputLines,
  textInputWrapWidth,
} from '../src/ui/TextInput.js'

test('text input wrap width accounts for surrounding chrome', () => {
  assert.equal(textInputWrapWidth(80), 70)
  assert.equal(textInputWrapWidth(80, 4), 76)
  assert.equal(textInputWrapWidth(8), 1)
})

test('multiline text input renders fixed-width visual rows without ellipsis', () => {
  const wrapWidth = 4
  const rendered = renderTextInputLines('abcdefghijkl', 7, true, wrapWidth)
  const output = stripAnsi(renderTextInputViewport(rendered, wrapWidth))
  const lines = output.trimEnd().split('\n').map(line => line.trimEnd())

  assert.equal(output.includes('...'), false)
  assert.equal(output.includes('\u2026'), false)
  assert.deepEqual(lines, ['> abcd', '  efgh', '  ijkl'])
  assert.ok(lines.every(line => line.length <= wrapWidth + 2), JSON.stringify(lines))
})

test('multiline text input places the cursor on the next visual row at wrap boundaries', () => {
  const rendered = renderTextInputLines('abcdefgh', 4, true, 4)
  const cursorLine = rendered.find(line => hasCursorBackground(line.node))

  assert.equal(cursorLine?.visualLineIndex, 1)
})

function renderTextInputViewport(
  rendered: ReturnType<typeof renderTextInputLines>,
  wrapWidth: number,
): string {
  return renderToString(
    React.createElement(
      Box,
      { flexDirection: 'column' },
      rendered.map(line => React.createElement(
        Box,
        { key: line.visualLineIndex, flexDirection: 'row' },
        React.createElement(Text, null, line.visualLineIndex === 0 ? '> ' : '  '),
        React.createElement(Box, { width: wrapWidth }, line.node),
      )),
    ),
  )
}

function hasCursorBackground(node: React.ReactNode): boolean {
  if (node === null || node === undefined || typeof node === 'boolean') return false
  if (Array.isArray(node)) return node.some(hasCursorBackground)
  if (!React.isValidElement(node)) return false

  const props = node.props as { backgroundColor?: string; children?: React.ReactNode }
  return Boolean(props.backgroundColor) || hasCursorBackground(props.children)
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}
