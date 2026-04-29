import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveEditorCommand } from '../src/identity/continuity/editor.js'

test('editor resolution prefers ETHAGENT_EDITOR over detected IDEs and env editors', () => {
  const command = resolveEditorCommand('/tmp/SOUL.md', {
    ETHAGENT_EDITOR: 'vim --wait',
    VISUAL: 'nano',
    EDITOR: 'ed',
  }, {
    platform: 'linux',
    commandExists: name => name === 'code' ? '/usr/bin/code' : null,
  })

  assert.deepEqual(command, {
    cmd: 'vim',
    args: ['--wait', '/tmp/SOUL.md'],
    method: 'vim',
    waited: true,
    shell: false,
  })
})

test('editor resolution detects IDE CLIs before VISUAL and EDITOR', () => {
  const command = resolveEditorCommand('/tmp/MEMORY.md', {
    VISUAL: 'nano',
    EDITOR: 'ed',
  }, {
    platform: 'linux',
    commandExists: name => name === 'cursor' ? '/usr/bin/cursor' : null,
  })

  assert.deepEqual(command, {
    cmd: '/usr/bin/cursor',
    args: ['/tmp/MEMORY.md'],
    method: 'cursor',
    waited: false,
    shell: false,
  })
})

test('editor resolution falls back to VISUAL, EDITOR, then OS default', () => {
  const visual = resolveEditorCommand('/tmp/SOUL.md', { VISUAL: 'nano -w', EDITOR: 'ed' }, {
    platform: 'linux',
    commandExists: () => null,
  })
  assert.deepEqual(visual, {
    cmd: 'nano',
    args: ['-w', '/tmp/SOUL.md'],
    method: 'nano',
    waited: true,
    shell: false,
  })

  const editor = resolveEditorCommand('/tmp/SOUL.md', { EDITOR: 'ed' }, {
    platform: 'linux',
    commandExists: () => null,
  })
  assert.deepEqual(editor, {
    cmd: 'ed',
    args: ['/tmp/SOUL.md'],
    method: 'ed',
    waited: true,
    shell: false,
  })

  const fallback = resolveEditorCommand('/tmp/SOUL.md', {}, {
    platform: 'darwin',
    commandExists: () => null,
  })
  assert.deepEqual(fallback, {
    cmd: 'open',
    args: ['/tmp/SOUL.md'],
    method: 'open',
    waited: false,
  })
})
