import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { render } from 'ink-testing-library'
import type { Key } from 'ink'
import { moveInList, navigateList, type ListPosition } from '../../src/app/keybindings/listNavigation.js'
import type { ListAction } from '../../src/app/keybindings/types.js'
import { Select, type SelectOption } from '../../src/ui/Select.js'
import { LazyMenu } from '../../src/identity/manager/shared/components/LazyMenu.js'

const ESC = String.fromCharCode(27)
const PAGE_UP = `${ESC}[5~`
const PAGE_DOWN = `${ESC}[6~`
const HOME = `${ESC}[1~`
const END = `${ESC}[4~`
const CTRL_U = String.fromCharCode(21)
const CTRL_D = String.fromCharCode(4)
const stripAnsi = (value: string): string => value.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '')
const noop = (): void => {}

// 'x' is a row the cursor can rest on, '-' a header or disabled row.
function list(shape: string, index: number, page = 3): ListPosition {
  return { index, count: shape.length, page, selectable: at => shape[at] === 'x' }
}

test('single steps wrap around the ends and skip rows that cannot be selected', () => {
  assert.equal(moveInList('list:down', list('x-xx', 0)), 2)
  assert.equal(moveInList('list:up', list('x-xx', 2)), 0)
  assert.equal(moveInList('list:up', list('x-xx', 0)), 3)
  assert.equal(moveInList('list:down', list('x-xx', 3)), 0)
  assert.equal(moveInList('list:down', list('-x-', 1)), 1)
  assert.equal(moveInList('list:up', list('-x-', 1)), 1)
})

test('page jumps move a page at a time and clamp at the ends instead of wrapping', () => {
  const rows = 'x'.repeat(10)
  assert.equal(moveInList('list:pageDown', list(rows, 0, 4)), 4)
  assert.equal(moveInList('list:pageDown', list(rows, 4, 4)), 8)
  assert.equal(moveInList('list:pageDown', list(rows, 8, 4)), 9)
  assert.equal(moveInList('list:pageDown', list(rows, 9, 4)), 9)
  assert.equal(moveInList('list:pageUp', list(rows, 9, 4)), 5)
  assert.equal(moveInList('list:pageUp', list(rows, 1, 4)), 0)
  assert.equal(moveInList('list:pageUp', list(rows, 0, 4)), 0)
  assert.equal(moveInList('list:pageDown', list(rows, 0, 0)), 1, 'a page is never smaller than one row')
})

test('a page jump that lands on an unselectable row moves past it, else back, else stays', () => {
  assert.equal(moveInList('list:pageDown', list('xxx-xxx', 0)), 4)
  assert.equal(moveInList('list:pageUp', list('xxx-xxx', 6)), 2)
  assert.equal(moveInList('list:pageDown', list('xxx--', 0, 4)), 2)
  assert.equal(moveInList('list:pageDown', list('xxx--', 2, 4)), 2)
  assert.equal(moveInList('list:pageUp', list('--xxx', 4, 4)), 2)
  assert.equal(moveInList('list:pageUp', list('--xxx', 2, 4)), 2)
})

test('first and last pick the outermost selectable rows', () => {
  assert.equal(moveInList('list:first', list('-xxx-', 3)), 1)
  assert.equal(moveInList('list:last', list('-xxx-', 1)), 3)
})

test('a list with nothing to select never moves', () => {
  const actions: ListAction[] = ['list:up', 'list:down', 'list:pageUp', 'list:pageDown', 'list:first', 'list:last']
  for (const action of actions) {
    assert.equal(moveInList(action, list('', 0)), 0)
    assert.equal(moveInList(action, list('---', 1)), 1)
  }
})

const NO_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
}

function pressed(input: string, held: Partial<Key> = {}): number | null {
  return navigateList(input, { ...NO_KEY, ...held }, list('x'.repeat(10), 5))
}

test('every list key resolves to its motion and other keys are left alone', () => {
  assert.equal(pressed('', { upArrow: true }), 4)
  assert.equal(pressed('k'), 4)
  assert.equal(pressed('', { downArrow: true }), 6)
  assert.equal(pressed('j'), 6)
  assert.equal(pressed('', { pageUp: true }), 2)
  assert.equal(pressed('u', { ctrl: true }), 2)
  assert.equal(pressed('', { pageDown: true }), 8)
  assert.equal(pressed('d', { ctrl: true }), 8)
  assert.equal(pressed('', { home: true }), 0)
  assert.equal(pressed('g'), 0)
  assert.equal(pressed('', { end: true }), 9)
  assert.equal(pressed('G', { shift: true }), 9)

  assert.equal(pressed('u'), null)
  assert.equal(pressed('d'), null)
  assert.equal(pressed('x'), null)
  assert.equal(pressed('c', { ctrl: true }), null)
  assert.equal(pressed('', { return: true }), null)
  assert.equal(pressed('', { escape: true, meta: true }), null)
})

type View = {
  stdin: { write: (data: string) => void }
  lastFrame: () => string | undefined
}

// Keypress tests wait on what the screen shows, never on a fixed delay, so a busy
// machine slows them down instead of failing them.
async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${what}`)
}

function cursorRow(view: View): string {
  return stripAnsi(view.lastFrame() ?? '').split('\n').find(line => line.includes('❯')) ?? ''
}

// A key typed the instant a frame appears can still reach the previous render's key
// handler. One timer turn after the frame lets React attach the new one first.
async function cursorOn(view: View, label: string): Promise<void> {
  await until(() => cursorRow(view).includes(label), `the cursor on ${label}`)
  await new Promise(resolve => setTimeout(resolve, 20))
}

async function press(view: View, key: string, label: string): Promise<void> {
  view.stdin.write(key)
  await cursorOn(view, label)
}

test('select pages through a long list and jumps to either end', async () => {
  const options: Array<SelectOption<string>> = [
    ...Array.from({ length: 30 }, (_, i) => ({ value: `row-${i + 1}`, label: `Row ${String(i + 1).padStart(2, '0')}` })),
    { value: 'back', label: 'Back', role: 'utility' },
  ]
  const view = render(<Select<string> options={options} maxVisible={5} onSubmit={noop} />)
  try {
    await cursorOn(view, 'Row 01')
    await press(view, PAGE_DOWN, 'Row 05')
    assert.match(stripAnsi(view.lastFrame() ?? ''), /↑ 2 earlier items/, 'the window follows the cursor')
    await press(view, CTRL_D, 'Row 09')
    await press(view, PAGE_UP, 'Row 05')
    await press(view, CTRL_U, 'Row 01')
    await press(view, END, 'Back')
    await press(view, HOME, 'Row 01')
    await press(view, 'G', 'Back')
    await press(view, 'g', 'Row 01')
  } finally {
    view.unmount()
  }
})

test('lazy menu page keys land on the first and last enabled rows', async () => {
  const chosen: string[] = []
  const view = render(
    <LazyMenu<string>
      width={42}
      rows={[
        { kind: 'section', label: 'Agent' },
        { value: 'profile', label: 'Public Profile', shortcut: 'p' },
        { value: 'skills', label: 'Skills', shortcut: 's' },
        { value: 'save', label: 'Save Snapshot', shortcut: 'a', disabled: true },
        { value: 'quit', label: 'Quit', shortcut: 'q' },
        { value: 'transfer', label: 'Prepare Transfer', shortcut: 't', disabled: true },
      ]}
      onSubmit={value => { chosen.push(value) }}
    />,
  )
  try {
    await cursorOn(view, 'Public Profile')
    await press(view, PAGE_DOWN, 'Quit')
    await press(view, PAGE_UP, 'Public Profile')
    await press(view, END, 'Quit')
    await press(view, HOME, 'Public Profile')
    await press(view, 'G', 'Quit')
    await press(view, 'g', 'Public Profile')
    assert.deepEqual(chosen, [], 'navigation keys never submit a row')
  } finally {
    view.unmount()
  }
})
