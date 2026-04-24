import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeToolWithPermissions } from '../src/runtime/toolExecution.js'

async function runDelete(cwd: string, input: Record<string, unknown>) {
  return executeToolWithPermissions({
    name: 'delete_file',
    input,
    permissionMode: 'accept-edits',
    cwd,
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })
}

test('delete_file deletes a file and records an edit-style result', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-delete-'))
  await fs.writeFile(path.join(cwd, 'index.html'), '<h1>delete me</h1>\n', 'utf8')

  const outcome = await runDelete(cwd, { path: 'index.html' })

  assert.equal(outcome.result.ok, true)
  assert.match(outcome.result.summary, /deleted index\.html/)
  await assert.rejects(fs.stat(path.join(cwd, 'index.html')), /ENOENT|no such file/i)
})

test('delete_file prompts even in accept-edits mode and respects denial', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-delete-'))
  await fs.writeFile(path.join(cwd, 'index.html'), '<h1>keep me</h1>\n', 'utf8')
  let prompts = 0

  const outcome = await executeToolWithPermissions({
    name: 'delete_file',
    input: { path: 'index.html' },
    permissionMode: 'accept-edits',
    cwd,
    getPermissionRules: () => [],
    requestPermission: async request => {
      prompts += 1
      assert.equal(request.kind, 'delete')
      return 'deny'
    },
    onDirectoryChange: () => {},
  })

  assert.equal(prompts, 1)
  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'delete_file denied')
  assert.equal(await fs.readFile(path.join(cwd, 'index.html'), 'utf8'), '<h1>keep me</h1>\n')
})

test('delete_file rejects directory targets', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-delete-'))
  await fs.mkdir(path.join(cwd, 'folder'))

  const outcome = await runDelete(cwd, { path: 'folder' })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'delete_file failed before execution')
  assert.match(outcome.result.content, /directory/i)
})

test('delete_file rejects shell-command-shaped paths', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-delete-'))

  const outcome = await runDelete(cwd, { path: 'rm -rf index.html' })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'delete_file failed before execution')
  assert.match(outcome.result.content, /shell command/i)
})
