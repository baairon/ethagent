import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'ink'
import { AppInputProvider } from '../../src/app/input/AppInputProvider.js'
import { PermissionPrompt, permissionDiffLineColor } from '../../src/chat/views/PermissionPrompt.js'
import { diffLineStyle, numberDiffLines } from '../../src/chat/display/DiffView.js'
import { theme } from '../../src/ui/theme.js'
import type { PermissionRequest } from '../../src/tools/contracts.js'

test('file permission prompt renders visual diff rows instead of raw patch metadata', () => {
  const request: PermissionRequest = {
    kind: 'edit',
    path: '/workspace/src/example.ts',
    relativePath: 'src/example.ts',
    directoryPath: '/workspace/src',
    title: 'Allow file edit?',
    subtitle: '/workspace/src/example.ts',
    before: 'old',
    after: 'new',
    diff: [
      '--- src/example.ts',
      '+++ src/example.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n'),
    changeSummary: 'edit src/example.ts',
  }

  const output = renderToString(
    React.createElement(AppInputProvider, null,
      React.createElement(PermissionPrompt, {
        request,
        onDecision: () => undefined,
        onCancel: () => undefined,
      }),
    ),
  )

  assert.doesNotMatch(output, /--- src\/example\.ts/)
  assert.doesNotMatch(output, /\+\+\+ src\/example\.ts/)
  assert.doesNotMatch(output, /@@ -1 \+1 @@/)
  assert.match(output, /1\s+- old/)
  assert.match(output, /1\s+\+ new/)
  assert.match(output, /- old/)
  assert.match(output, /\+ new/)
  assert.doesNotMatch(output, /-old/)
  assert.doesNotMatch(output, /\+new/)
  assert.doesNotMatch(output, /\bbefore\b/)
  assert.doesNotMatch(output, /\bafter\b/)
})

test('permissionDiffLineColor color-codes unified diff line kinds', () => {
  assert.equal(permissionDiffLineColor('+++ file'), theme.diffAdded)
  assert.equal(permissionDiffLineColor('+added'), theme.text)
  assert.equal(permissionDiffLineColor('--- file'), theme.diffRemoved)
  assert.equal(permissionDiffLineColor('-removed'), theme.text)
  assert.equal(permissionDiffLineColor('@@ -1 +1 @@'), theme.accentPeriwinkle)
  assert.equal(permissionDiffLineColor(' context'), theme.textSubtle)
})

test('diffLineStyle highlights added and deleted code lines', () => {
  assert.deepEqual(diffLineStyle('+added'), {
    tone: 'added',
    color: theme.text,
    backgroundColor: theme.diffAddedBackground,
  })
  assert.deepEqual(diffLineStyle('-removed'), {
    tone: 'removed',
    color: theme.text,
    backgroundColor: theme.diffRemovedBackground,
  })
})

test('numberDiffLines preserves old and new file line numbers from hunk headers', () => {
  assert.deepEqual(numberDiffLines([
    '--- hello.py',
    '+++ hello.py',
    '@@ -10,2 +10,2 @@',
    ' context',
    '-old',
    '+new',
  ].join('\n')), [
    { line: '--- hello.py' },
    { line: '+++ hello.py' },
    { line: '@@ -10,2 +10,2 @@' },
    { line: ' context', oldLine: 10, newLine: 10 },
    { line: '-old', oldLine: 11 },
    { line: '+new', newLine: 11 },
  ])
})
