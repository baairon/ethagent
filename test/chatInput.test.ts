import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { Box, Text, renderToString } from 'ink'
import { inputWrapWidth, renderWithCursor } from '../src/ui/ChatInput.js'

test('chat input wraps long words without truncation props', () => {
  const rendered = renderWithCursor('averyverylongwordwithoutspaces', 10, true, 8, 5)

  assert.ok(rendered.lines.length > 1)
  const wraps = collectWrapProps(rendered.lines.map(line => line.node))
  assert.ok(wraps.length > 0)
  assert.equal(wraps.some(wrap => wrap === 'truncate'), false)
  assert.ok(wraps.every(wrap => wrap === 'wrap'))
})

test('chat input wrap width accounts for prompt chrome', () => {
  assert.equal(inputWrapWidth(80), 70)
  assert.equal(inputWrapWidth(8), 1)
})

test('chat input renders long words across rows without ellipsis', () => {
  const wrapWidth = 8
  const rendered = renderWithCursor('averyverylongwordwithoutspaces', 10, true, wrapWidth, 5)
  const output = stripAnsi(renderInputViewport(rendered, wrapWidth))
  const lines = output.split('\n')

  assert.equal(output.includes('...'), false)
  assert.equal(output.includes('\u2026'), false)
  assert.ok(lines.length > 1)
  assert.ok(lines.every(line => line.length <= wrapWidth + 2), JSON.stringify(lines))
})

function collectWrapProps(node: React.ReactNode): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(collectWrapProps)
  if (!React.isValidElement(node)) return []

  const props = node.props as { wrap?: string; children?: React.ReactNode }
  return [
    ...(props.wrap ? [props.wrap] : []),
    ...collectWrapProps(props.children),
  ]
}

function renderInputViewport(
  rendered: ReturnType<typeof renderWithCursor>,
  wrapWidth: number,
): string {
  return renderToString(
    React.createElement(
      Box,
      { flexDirection: 'column' },
      rendered.lines.map(line => React.createElement(
        Box,
        { key: line.visualLineIndex, flexDirection: 'row' },
        React.createElement(Text, null, line.visualLineIndex === 0 ? '> ' : '  '),
        React.createElement(Box, { width: wrapWidth }, line.node),
      )),
    ),
  )
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
}
