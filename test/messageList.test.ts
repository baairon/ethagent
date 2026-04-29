import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import {
  MessageList,
  reasoningBorderColor,
  reasoningCursorVisible,
  type MessageRow,
} from '../src/ui/MessageList.js'
import { theme } from '../src/ui/theme.js'

test('reasoning rows use peach accent while streaming, never lavender', () => {
  const row: MessageRow = {
    role: 'thinking',
    id: 'thinking-1',
    content: 'checking',
    streaming: true,
    showCursor: true,
  }

  assert.equal(reasoningBorderColor(row), theme.accentPeach)
  assert.notEqual(reasoningBorderColor(row), theme.accentLavender)
})

test('reasoning cursor visibility is explicit and disabled after streaming', () => {
  const active: MessageRow = {
    role: 'thinking',
    id: 'thinking-1',
    content: 'checking',
    streaming: true,
    showCursor: true,
  }
  const answering: MessageRow = { ...active, showCursor: false }
  const finalized: MessageRow = { ...active, streaming: false, showCursor: false }

  assert.equal(reasoningCursorVisible(active), true)
  assert.equal(reasoningCursorVisible(answering), false)
  assert.equal(reasoningCursorVisible(finalized), false)
})

test('assistant inline markdown hides emphasis and math delimiters', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'assistant',
        id: 'assistant-1',
        content: ' **6. Animalistic Return**\nMath: \\{x\\}, $y$, and /{z/}',
      }],
    }),
  )

  assert.match(output, /6\. Animalistic Return/)
  assert.equal(output.includes('**'), false)
  assert.equal(output.includes('\\{'), false)
  assert.equal(output.includes('/{'), false)
  assert.equal(output.includes('$'), false)
})
