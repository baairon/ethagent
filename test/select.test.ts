import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import { AppInputProvider } from '../src/app/input/AppInputProvider.js'
import { Select } from '../src/ui/Select.js'

test('select renders colored section headers and indented inline hints', () => {
  const output = renderToString(
    React.createElement(AppInputProvider, null,
      React.createElement(Select<'run'>, {
        options: [
          { value: 'run', role: 'section', prefix: '--', label: 'Actions' },
          { value: 'run', label: 'run backup', hint: 'save encrypted state' },
        ],
        hintLayout: 'inline',
        onSubmit: () => undefined,
      }),
    ),
  )

  assert.match(output, /Actions/)
  assert.doesNotMatch(output, /-- Actions/)
  assert.match(output, /> run backup  save encrypted state/)
})

test('select renders muted option subtext below the label', () => {
  const output = renderToString(
    React.createElement(AppInputProvider, null,
      React.createElement(Select<'model'>, {
        options: [
          { value: 'model', label: 'qwen3:8b', subtext: '5.2 GB · installed' },
        ],
        onSubmit: () => undefined,
      }),
    ),
  )

  assert.match(output, /> qwen3:8b/)
  assert.match(output, /5\.2 GB · installed/)
})
