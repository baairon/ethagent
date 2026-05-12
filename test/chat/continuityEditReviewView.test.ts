import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import { AppInputProvider } from '../../src/app/input/AppInputProvider.js'
import { ContinuityEditReviewView } from '../../src/chat/views/ContinuityEditReviewView.js'

test('continuity edit review panel renders saved MEMORY/SOUL diffs with line numbers', () => {
  const output = renderToString(
    React.createElement(AppInputProvider, null,
      React.createElement(ContinuityEditReviewView, {
        review: {
          file: 'MEMORY.md',
          filePath: 'C:\\Users\\bairo\\.ethagent\\continuity\\agent\\MEMORY.md',
          summary: 'append to Durable User Preferences in MEMORY.md',
          diff: [
            '--- MEMORY.md',
            '+++ MEMORY.md',
            '@@ -4 +4,2 @@',
            ' - Existing preference',
            '+- New preference',
          ].join('\n'),
        },
        onSelect: () => undefined,
        onCancel: () => undefined,
      }),
    ),
  )

  assert.match(output, /MEMORY\.md Updated/)
  assert.doesNotMatch(output, /--- MEMORY\.md/)
  assert.doesNotMatch(output, /\+\+\+ MEMORY\.md/)
  assert.doesNotMatch(output, /@@ -4 \+4,2 @@/)
  assert.doesNotMatch(output, /4\s+4\s+- Existing preference/)
  assert.match(output, /4\s+- Existing preference/)
  assert.match(output, /5\s+\+ - New preference/)
  assert.doesNotMatch(output, /5\s+\+- New preference/)
  assert.match(output, /Open MEMORY\.md/)
})
