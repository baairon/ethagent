import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import {
  MessageList,
  reasoningBorderColor,
  reasoningCursorVisible,
  sanitizeReasoningForDisplay,
  toggleReasoningRow,
  type MessageRow,
} from '../src/chat/MessageList.js'
import { sessionMessagesToRows } from '../src/chat/chatScreenUtils.js'
import { Spinner } from '../src/ui/Spinner.js'
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

test('toggleReasoningRow can target an older visible reasoning row', () => {
  const rows: MessageRow[] = [
    { role: 'thinking', id: 'old', content: 'old reasoning', expanded: false },
    { role: 'assistant', id: 'a', content: 'answer' },
    { role: 'thinking', id: 'new', content: 'new reasoning', expanded: false },
  ]

  const next = toggleReasoningRow(rows, 'old')

  assert.equal((next[0] as Extract<MessageRow, { role: 'thinking' }>).expanded, true)
  assert.equal((next[2] as Extract<MessageRow, { role: 'thinking' }>).expanded, false)
})

test('toggleReasoningRow falls back to the latest reasoning row without a target', () => {
  const rows: MessageRow[] = [
    { role: 'thinking', id: 'old', content: 'old reasoning', expanded: false },
    { role: 'thinking', id: 'new', content: 'new reasoning', expanded: false },
  ]

  const next = toggleReasoningRow(rows)

  assert.equal((next[0] as Extract<MessageRow, { role: 'thinking' }>).expanded, false)
  assert.equal((next[1] as Extract<MessageRow, { role: 'thinking' }>).expanded, true)
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

test('assistant headings render without hash indicators through level six', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'assistant',
        id: 'assistant-1',
        content: '#### **Deep Heading**\nBody text',
      }],
    }),
  )

  assert.match(output, /Deep Heading/)
  assert.match(output, /Body text/)
  assert.equal(output.includes('####'), false)
  assert.equal(output.includes('**'), false)
})

test('reasoning rows render raw markdown markers without assistant markdown styling', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'thinking',
        id: 'thinking-raw',
        content: '## Reasoning\nKeep **markers** visible.',
        expanded: true,
      }],
    }),
  )

  assert.match(output, /## Reasoning/)
  assert.match(output, /\*\*markers\*\*/)
})

test('reasoning sanitizer keeps readable reasoning text intact', () => {
  const input = 'Plan:\n1. Check installed model.\n2. Start llama.cpp with the selected GGUF.'

  assert.equal(sanitizeReasoningForDisplay(input), input)
})

test('reasoning sanitizer replaces binary-looking text with a readable placeholder', () => {
  const input = '4-2%+&\'3481*/BD%4/<:81-@$9,0==20D%=C\'G3$/E2>D/=)'.repeat(4)

  assert.equal(sanitizeReasoningForDisplay(input), 'reasoning output was not readable text')
})

test('reasoning sanitizer strips control characters without mutating readable text', () => {
  const input = '\u001b[31mInspecting\u001b[0m\tinstalled model\u0007'

  assert.equal(sanitizeReasoningForDisplay(input), 'Inspecting  installed model')
})

test('successful read tool results do not render file contents in the transcript', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_result',
        id: 'read-result',
        name: 'read_file',
        summary: 'read package.json',
        content: 'sensitive or very long file contents',
      }],
    }),
  )

  assert.match(output, /result/)
  assert.match(output, /read_file/)
  assert.match(output, /read package\.json/)
  assert.doesNotMatch(output, /sensitive or very long file contents/)
})

test('failed read tool results still render the error', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_result',
        id: 'read-error',
        name: 'read_file',
        summary: 'read_file failed',
        content: 'file does not exist',
        isError: true,
      }],
    }),
  )

  assert.match(output, /file does not exist/)
})

test('restored successful read results keep file contents out of row state', () => {
  let id = 0
  const rows = sessionMessagesToRows([{
    version: 2,
    role: 'tool_result',
    toolUseId: 'tool-1',
    name: 'read_file',
    content: 'restored file contents',
    createdAt: new Date(0).toISOString(),
  }], () => `row-${++id}`)

  assert.equal(rows[0]?.role, 'tool_result')
  assert.equal((rows[0] as Extract<MessageRow, { role: 'tool_result' }>).content, '')
})

test('indeterminate progress rows render as spinner activity', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'progress',
        id: 'compact-1',
        title: 'compacting conversation',
        progress: 0,
        status: 'summarizing with local model',
        suffix: 'esc to cancel',
        indeterminate: true,
      }],
    }),
  )

  assert.match(output, /compacting conversation/)
  assert.match(output, /summarizing with local model/)
  assert.match(output, /esc to cancel/)
  assert.doesNotMatch(output, /0%/)
})

test('spinner renders elapsed time', () => {
  const output = renderToString(
    React.createElement(Spinner, {
      label: 'working',
      startedAt: Date.now() - 65_000,
    }),
  )

  assert.match(output, /working/)
  assert.match(output, /1:05|1:06/)
})
