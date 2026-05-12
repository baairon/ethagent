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
} from '../../src/chat/MessageList.js'
import { sessionMessagesToRows } from '../../src/chat/chatScreenUtils.js'
import { syntaxLineSpans } from '../../src/chat/display/SyntaxText.js'
import { Spinner } from '../../src/ui/Spinner.js'
import { theme } from '../../src/ui/theme.js'
import { formatFileChangeResult } from '../../src/tools/fileDiff.js'

test('reasoning rows use mint accent while streaming', () => {
  const row: MessageRow = {
    role: 'thinking',
    id: 'thinking-1',
    content: 'checking',
    streaming: true,
    showCursor: true,
  }

  assert.equal(reasoningBorderColor(row), theme.accentPeriwinkle)
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

test('streaming reasoning label renders without a cursor or inline spinner', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'thinking',
        id: 'thinking-streaming',
        content: 'checking',
        streaming: true,
        showCursor: false,
        expanded: false,
      }],
    }),
  )

  assert.match(output, /\u2022 Thinking/)
  assert.match(output, /Thinking\s+\u00b7 alt\+t inspect/)
  assert.doesNotMatch(output, /\u2022 [\u00b7\u2219\u2022]\s+Thinking/)
  assert.doesNotMatch(output, /\|/)
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

test('toggleReasoningRow skips a trailing tool_call and falls back to the latest reasoning row', () => {
  const rows: MessageRow[] = [
    { role: 'thinking', id: 'r1', content: 'reasoning', expanded: false },
    {
      role: 'tool_call',
      id: 'tc-1',
      name: 'run_bash',
      summary: 'run_bash',
      input: { command: 'ls' },
      result: { content: 'ok', summary: 'exit 0', isError: false },
    },
  ]

  const next = toggleReasoningRow(rows)

  assert.equal((next[0] as Extract<MessageRow, { role: 'thinking' }>).expanded, true)
  assert.equal(next[1], rows[1])
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

  assert.match(output, /\u2022 6\. Animalistic Return/)
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

  assert.match(output, /\u2022 Deep Heading/)
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

  assert.match(output, /\u2022 Thinking…/)
  assert.match(output, /alt\+t collapse/)
  assert.match(output, /## Reasoning/)
  assert.match(output, /\*\*markers\*\*/)
  assert.doesNotMatch(output, /▌/)
  assert.doesNotMatch(output, /reasoning/)
  assert.doesNotMatch(output, /01 ## Reasoning/)
  assert.doesNotMatch(output, /[╭╮╰╯│]/)
  assert.doesNotMatch(output, /─{4,}/)
})

test('collapsed reasoning rows render as a compact thinking label', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'thinking',
        id: 'thinking-collapsed',
        content: 'internal preview should stay hidden',
        expanded: false,
      }],
    }),
  )

  assert.match(output, /\u2022 Thinking/)
  assert.match(output, /alt\+t inspect/)
  assert.doesNotMatch(output, /▌/)
  assert.doesNotMatch(output, /internal preview should stay hidden/)
  assert.doesNotMatch(output, /reasoning/)
})

test('assistant code blocks render as compact labeled blocks without panel borders or gutters', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'assistant',
        id: 'assistant-code',
        content: 'Here:\n```python\nprint("hello world!")\n```',
      }],
    }),
  )

  assert.match(output, /\u2022 Here:/)
  assert.match(output, /\u2022 python/)
  assert.match(output, /print\("hello world!"\)/)
  assert.doesNotMatch(output, /▌/)
  assert.doesNotMatch(output, /block/)
  assert.doesNotMatch(output, /01 print\("hello world!"\)/)
  assert.doesNotMatch(output, /[╭╮╰╯│]/)
  assert.doesNotMatch(output, /─{4,}/)
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

test('successful read tool results do not surface file contents in the transcript', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_call',
        id: 'read-result',
        name: 'read_file',
        summary: 'read_file',
        input: { path: 'package.json' },
        result: { content: 'sensitive or very long file contents', summary: 'read package.json', isError: false },
      }],
    }),
  )

  assert.match(output, /Read/)
  assert.match(output, /package\.json/)
  assert.doesNotMatch(output, /sensitive or very long file contents/)
})

test('failed read tool results surface the failure summary, not the error body', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_call',
        id: 'read-error',
        name: 'read_file',
        summary: 'read_file',
        result: { content: 'file does not exist', summary: 'read_file failed', isError: true },
      }],
    }),
  )

  assert.match(output, /read_file failed/)
  assert.doesNotMatch(output, /file does not exist/)
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

  assert.equal(rows[0]?.role, 'tool_call')
  const row = rows[0] as Extract<MessageRow, { role: 'tool_call' }>
  assert.equal(row.result?.content, '')
})

test('successful tool_call rows hide the redundant result summary line', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_call',
        id: 'tc-1',
        name: 'run_bash',
        summary: 'run_bash',
        input: { command: 'ls' },
        result: { content: 'file.txt', summary: 'exit 0', isError: false },
      }],
    }),
  )

  assert.match(output, /Bash/)
  assert.match(output, /ls/)
  assert.doesNotMatch(output, /▌/)
  assert.doesNotMatch(output, /exit 0/)
  assert.doesNotMatch(output, /⎿/)
  assert.doesNotMatch(output, /alt\+t inspect/)
  assert.doesNotMatch(output, /─{4,}/)
})

test('successful file edit tool_call rows render stored diffs inline', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_call',
        id: 'edit-result',
        name: 'edit_file',
        summary: 'edit_file',
        input: { path: 'hello.py' },
        result: {
          content: 'updated hello.py',
          summary: 'edit hello.py',
          isError: false,
          diff: '--- hello.py\n+++ hello.py\n@@ -1 +1 @@\n-print("old")\n+print("new")',
        },
      }],
    }),
  )

  assert.match(output, /Edit/)
  assert.match(output, /hello\.py/)
  assert.doesNotMatch(output, /--- hello\.py/)
  assert.doesNotMatch(output, /\+\+\+ hello\.py/)
  assert.doesNotMatch(output, /@@ -1 \+1 @@/)
  assert.match(output, /- print\("old"\)/)
  assert.match(output, /\+ print\("new"\)/)
  assert.doesNotMatch(output, /-print\("old"\)/)
  assert.doesNotMatch(output, /\+print\("new"\)/)
  assert.doesNotMatch(output, /edit hello\.py/)
})

test('syntax highlighting only applies language token colors to programming languages', () => {
  const python = syntaxLineSpans('def greet(name):', 'python')
  const markdown = syntaxLineSpans('def greet(name):', 'markdown')

  assert.ok(python.some(span => span.color === theme.codeKeyword))
  assert.deepEqual(markdown, [{ text: 'def greet(name):', color: theme.textSubtle }])
})

test('restored file edit tool results keep hidden diff for transcript display', () => {
  let id = 0
  const rows = sessionMessagesToRows([
    {
      version: 2,
      role: 'tool_use',
      toolUseId: 'tool-1',
      name: 'edit_file',
      input: { path: 'hello.py' },
      createdAt: new Date(0).toISOString(),
    },
    {
      version: 2,
      role: 'tool_result',
      toolUseId: 'tool-1',
      name: 'edit_file',
      content: formatFileChangeResult(
        'updated hello.py',
        '--- hello.py\n+++ hello.py\n@@ -1 +1 @@\n-old\n+new',
      ),
      createdAt: new Date(0).toISOString(),
    },
  ], () => `row-${++id}`)

  assert.equal(rows[0]?.role, 'tool_call')
  const row = rows[0] as Extract<MessageRow, { role: 'tool_call' }>
  assert.equal(row.result?.content, 'updated hello.py')
  assert.equal(row.result?.diff, '--- hello.py\n+++ hello.py\n@@ -1 +1 @@\n-old\n+new')
})

test('consecutive successful tool_call rows stack tight without blank lines between them', () => {
  const rows: MessageRow[] = [
    { role: 'tool_call', id: 'tc-a', name: 'list_directory', summary: 'list_directory', input: { path: '.' }, result: { content: '', summary: 'listed .', isError: false } },
    { role: 'tool_call', id: 'tc-b', name: 'list_directory', summary: 'list_directory', input: { path: 'src' }, result: { content: '', summary: 'listed src', isError: false } },
    { role: 'tool_call', id: 'tc-c', name: 'list_directory', summary: 'list_directory', input: { path: 'test' }, result: { content: '', summary: 'listed test', isError: false } },
  ]
  const output = renderToString(React.createElement(MessageList, { rows }))
  const lines = output.split('\n').filter(line => line.trim().length > 0)
  assert.equal(lines.length, 3, `expected 3 non-blank lines for 3 tight-stacked tool calls, got ${lines.length}: ${JSON.stringify(lines)}`)
})

test('tool_call rows show running state until a result attaches', () => {
  const output = renderToString(
    React.createElement(MessageList, {
      rows: [{
        role: 'tool_call',
        id: 'tc-running',
        name: 'run_bash',
        summary: 'run_bash',
        input: { command: 'ls' },
      }],
    }),
  )

  assert.match(output, /Bash/)
  assert.match(output, /running/)
  assert.doesNotMatch(output, /alt\+t inspect/)
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
  assert.match(output, /Summarizing with local model/)
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

  assert.match(output, /Working/)
  assert.match(output, /1:05|1:06/)
})

test('spinner sentence-cases provided label while keeping hint lowercase', () => {
  const output = renderToString(
    React.createElement(Spinner, {
      label: 'Starting ethagent...',
      hint: 'Waiting For Wallet',
      showElapsed: false,
    }),
  )

  assert.match(output, /Starting ethagent\.\.\./)
  assert.match(output, /waiting for wallet/)
  assert.doesNotMatch(output, /starting ethagent/)
  assert.doesNotMatch(output, /Waiting For Wallet/)
})

test('spinner preserves common product and protocol capitalization', () => {
  const output = renderToString(
    React.createElement(Spinner, {
      label: 'checking ens, ipfs, openai, anthropic, gemini, and erc-8004...',
      hint: 'soul.md and memory.md',
      showElapsed: false,
    }),
  )

  assert.match(output, /Checking ENS, IPFS, OpenAI, Anthropic, Gemini, and ERC-8004\.\.\./)
  assert.match(output, /SOUL\.md and\s+MEMORY\.md/)
})

test('spinner sentence-cases generated verbs', () => {
  const output = renderToString(
    React.createElement(Spinner, {
      verb: 'thinking',
      showElapsed: false,
    }),
  )

  assert.match(output, /Thinking/)
})
