import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import { LazyMenu } from '../../../src/identity/manager/shared/components/LazyMenu.js'
import { changeSummaryCandidates, type LocalChangeItem } from '../../../src/identity/manager/continuity/state.js'
import { wrapWords } from '../../../src/ui/text.js'

const WIDTH = 42

function stripAnsi(value: string): string {
  return value.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
}

function renderMenu(inlineNote: string | readonly string[]) {
  return render(
    <LazyMenu<string>
      width={WIDTH}
      rows={[
        { value: 'backup', label: 'Save Snapshot', shortcut: 'a', inlineNote, inlineNoteColor: '#e8b8b8' },
        { value: 'quit', label: 'Quit', shortcut: 'q' },
      ]}
      onSubmit={() => {}}
    />,
  )
}

const items: LocalChangeItem[] = [
  { name: 'SOUL.md', kind: 'file', change: 'modified' },
  { name: 'MEMORY.md', kind: 'file', change: 'modified' },
  { name: 'browser', kind: 'skill', change: 'added' },
  { name: 'canvas', kind: 'skill', change: 'modified' },
]

test('lazy menu picks the most detailed change summary that fits, never a cut word', () => {
  const { lastFrame, unmount } = renderMenu(changeSummaryCandidates(items))
  try {
    const lines = stripAnsi(lastFrame() ?? '').split('\n')
    const row = lines.find(line => line.includes('Save Snapshot'))
    assert.ok(row, 'expected the Save Snapshot row to render')
    assert.match(row!, /Save Snapshot {2}4 changes/)
    assert.doesNotMatch(row!, /…/)
    assert.equal(row!.trimEnd().endsWith('a'), true, 'shortcut must stay right-aligned on the same line')
    for (const line of lines) {
      assert.ok(line.length <= WIDTH, `no rendered line may exceed the menu width (got ${line.length}: "${line}")`)
    }
  } finally {
    unmount()
  }
})

test('lazy menu keeps a short inline note intact', () => {
  const { lastFrame, unmount } = renderMenu('SOUL.md')
  try {
    const row = stripAnsi(lastFrame() ?? '').split('\n').find(line => line.includes('Save Snapshot'))
    assert.ok(row)
    assert.match(row!, /SOUL\.md/)
    assert.doesNotMatch(row!, /…/)
  } finally {
    unmount()
  }
})

test('lazy menu moves a note that cannot fit onto its own line instead of cutting it', () => {
  const note = 'Unsaved changes in every corner of the vault'
  const { lastFrame, unmount } = renderMenu(note)
  try {
    const text = stripAnsi(lastFrame() ?? '')
    assert.ok(text.replace(/\s+/g, ' ').includes(note), 'the whole note must render')
    assert.doesNotMatch(text, /…/)
  } finally {
    unmount()
  }
})

test('change summaries go from full names to a skill count to a total', () => {
  assert.deepEqual(changeSummaryCandidates(items), [
    'SOUL.md, MEMORY.md, browser, canvas',
    'SOUL.md, MEMORY.md, 2 skills',
    '4 changes',
  ])
  assert.deepEqual(changeSummaryCandidates([items[1]!]), ['MEMORY.md'])
})

test('word wrapping trims at the break instead of starting a line with a space', () => {
  const lines = wrapWords('Choose a root .eth name to create an agent subdomain under.', 42)
  assert.deepEqual(lines, ['Choose a root .eth name to create an agent', 'subdomain under.'])
  assert.deepEqual(wrapWords('abcdefghij', 4), ['abcd', 'efgh', 'ij'])
})
