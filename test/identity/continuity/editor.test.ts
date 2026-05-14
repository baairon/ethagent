import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultEditorCommand,
  isVscodeEnvironment,
  vscodeEditorCommand,
} from '../../../src/identity/continuity/editor.js'

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

test('isVscodeEnvironment is true when TERM_PROGRAM=vscode', () => {
  assert.equal(isVscodeEnvironment({ TERM_PROGRAM: 'vscode' }), true)
})

test('isVscodeEnvironment is true when VSCODE_PID is set', () => {
  assert.equal(isVscodeEnvironment({ VSCODE_PID: '12345' }), true)
})

test('isVscodeEnvironment is true when VSCODE_GIT_IPC_HANDLE is set', () => {
  assert.equal(isVscodeEnvironment({ VSCODE_GIT_IPC_HANDLE: '/tmp/vscode-git-abc.sock' }), true)
})

test('isVscodeEnvironment is false when no VS Code signal is present', () => {
  assert.equal(isVscodeEnvironment({ TERM_PROGRAM: 'Apple_Terminal', PATH: '/usr/bin' }), false)
  assert.equal(isVscodeEnvironment({}), false)
})

test('vscodeEditorCommand on Windows wraps with cmd /c', () => {
  const command = vscodeEditorCommand('C:/tmp/SOUL.md', 'win32')
  assert.deepEqual(command, {
    cmd: 'cmd',
    args: ['/c', 'code', '--reuse-window', 'C:/tmp/SOUL.md'],
    method: 'vscode',
    waited: false,
  })
})

test('vscodeEditorCommand on macOS calls code directly with --reuse-window', () => {
  const command = vscodeEditorCommand('/tmp/MEMORY.md', 'darwin')
  assert.deepEqual(command, {
    cmd: 'code',
    args: ['--reuse-window', '/tmp/MEMORY.md'],
    method: 'vscode',
    waited: false,
  })
})

test('vscodeEditorCommand on Linux calls code directly with --reuse-window', () => {
  const command = vscodeEditorCommand('/tmp/skills.json', 'linux')
  assert.deepEqual(command, {
    cmd: 'code',
    args: ['--reuse-window', '/tmp/skills.json'],
    method: 'vscode',
    waited: false,
  })
})
