import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import { AppInputProvider } from '../src/input/AppInputProvider.js'
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
