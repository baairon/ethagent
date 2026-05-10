import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultEditorCommand } from '../../../src/identity/continuity/editor.js'

test('defaultEditorCommand uses cmd /c start on Windows', () => {
  const command = defaultEditorCommand('C:/tmp/SOUL.md', 'win32')
  assert.deepEqual(command, {
    cmd: 'cmd',
    args: ['/c', 'start', '', 'C:/tmp/SOUL.md'],
    method: 'cmd',
    waited: false,
  })
})

test('defaultEditorCommand uses open on macOS', () => {
  const command = defaultEditorCommand('/tmp/MEMORY.md', 'darwin')
  assert.deepEqual(command, {
    cmd: 'open',
    args: ['/tmp/MEMORY.md'],
    method: 'open',
    waited: false,
  })
})

test('defaultEditorCommand uses xdg-open on Linux', () => {
  const command = defaultEditorCommand('/tmp/skills.json', 'linux')
  assert.deepEqual(command, {
    cmd: 'xdg-open',
    args: ['/tmp/skills.json'],
    method: 'xdg-open',
    waited: false,
  })
})
