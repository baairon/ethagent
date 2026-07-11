import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { LazyMenu } from '../../../src/identity/manager/shared/components/LazyMenu.js'

const WIDTH = 42

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

test('lazy menu truncates a long inline note instead of wrapping the row', () => {
  const { lastFrame, unmount } = render(
    <LazyMenu<string>
      width={WIDTH}
      rows={[
        { value: 'backup', label: 'Save Snapshot', shortcut: 'a', inlineNote: 'SOUL.md, MEMORY.md, Skills', inlineNoteColor: '#e8b8b8' },
        { value: 'quit', label: 'Quit', shortcut: 'q' },
      ]}
      onSubmit={() => {}}
    />,
  )
  try {
    const frame = stripAnsi(lastFrame() ?? '')
    const lines = frame.split('\n')
    const row = lines.find(line => line.includes('Save Snapshot'))
    assert.ok(row, 'expected the Save Snapshot row to render')
    assert.match(row!, /SOUL\.md, MEMORY\.md, S…/)
    assert.doesNotMatch(row!, /Skills/)
    assert.equal(row!.trimEnd().endsWith('a'), true, 'shortcut must stay right-aligned on the same line')
    for (const line of lines) {
      assert.ok(line.length <= WIDTH, `no rendered line may exceed the menu width (got ${line.length}: "${line}")`)
    }
  } finally {
    unmount()
  }
})

test('lazy menu keeps a short inline note intact', () => {
  const { lastFrame, unmount } = render(
    <LazyMenu<string>
      width={WIDTH}
      rows={[
        { value: 'backup', label: 'Save Snapshot', shortcut: 'a', inlineNote: 'SOUL.md' },
      ]}
      onSubmit={() => {}}
    />,
  )
  try {
    const frame = stripAnsi(lastFrame() ?? '')
    const row = frame.split('\n').find(line => line.includes('Save Snapshot'))
    assert.ok(row)
    assert.match(row!, /SOUL\.md/)
    assert.doesNotMatch(row!, /…/)
  } finally {
    unmount()
  }
})
