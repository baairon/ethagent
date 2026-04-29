import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeToolWithPermissions } from '../src/runtime/toolExecution.js'
import type { EthagentConfig } from '../src/storage/config.js'

async function runEdit(cwd: string, input: Record<string, unknown>, config?: EthagentConfig) {
  return executeToolWithPermissions({
    name: 'edit_file',
    input,
    permissionMode: 'accept-edits',
    cwd,
    config,
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })
}

test('edit_file creates a missing file without oldText', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))

  const outcome = await runEdit(cwd, { path: 'new.txt', newText: 'hello\n' })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'new.txt'), 'utf8'), 'hello\n')
})

test('edit_file allows whole-file write on existing files without oldText', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))
  await fs.writeFile(path.join(cwd, 'site.html'), '<h1>Old</h1>\n<p>Keep me</p>\n', 'utf8')

  const outcome = await runEdit(cwd, { path: 'site.html', newText: '<h1>New</h1>\n' })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'site.html'), 'utf8'), '<h1>New</h1>\n')
})

test('edit_file applies targeted oldText replacement to existing files', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))
  await fs.writeFile(path.join(cwd, 'site.html'), '<h1>Old</h1>\n<p>Keep me</p>\n', 'utf8')

  const outcome = await runEdit(cwd, {
    path: 'site.html',
    oldText: '<h1>Old</h1>',
    newText: '<h1>New</h1>',
  })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'site.html'), 'utf8'), '<h1>New</h1>\n<p>Keep me</p>\n')
})

test('edit_file allows explicit whole-file replacement', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))
  await fs.writeFile(path.join(cwd, 'site.html'), '<h1>Old</h1>\n<p>Remove me</p>\n', 'utf8')

  const outcome = await runEdit(cwd, {
    path: 'site.html',
    newText: '<h1>New</h1>\n',
    replaceWholeFile: true,
  })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'site.html'), 'utf8'), '<h1>New</h1>\n')
})

test('edit_file rejects shell-command-shaped paths', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))

  const outcome = await runEdit(cwd, { path: 'rm -rf css/style.css', newText: 'body {}\n' })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'edit_file failed before execution')
  assert.match(outcome.result.content, /shell command/i)
})

test('edit_file rejects directory targets before filesystem writes', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))
  await fs.mkdir(path.join(cwd, 'folder'))

  const outcome = await runEdit(cwd, { path: 'folder', newText: 'hello\n' })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'edit_file failed before execution')
  assert.match(outcome.result.content, /directory/i)
})

test('edit_file rejects empty whole-file writes', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))

  const outcome = await runEdit(cwd, { path: 'empty.html', newText: '' })

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'edit_file failed before execution')
  assert.match(outcome.result.content, /newText is empty/i)
})

test('edit_file refuses private continuity markdown when identity is linked', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-edit-'))
  await fs.writeFile(path.join(cwd, 'SOUL.md'), '# Wrong workspace soul\n', 'utf8')

  const outcome = await runEdit(cwd, {
    path: 'SOUL.md',
    oldText: 'Wrong workspace soul',
    newText: 'updated',
  }, identityConfig())

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'edit_file failed before execution')
  assert.match(outcome.result.content, /propose_private_continuity_edit/)
  assert.equal(await fs.readFile(path.join(cwd, 'SOUL.md'), 'utf8'), '# Wrong workspace soul\n')
})

function identityConfig(): EthagentConfig {
  return {
    version: 1,
    provider: 'openai',
    model: 'gpt-test',
    firstRunAt: new Date(0).toISOString(),
    identity: {
      source: 'erc8004',
      address: '0x000000000000000000000000000000000000dEaD',
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      agentId: '42',
    },
  }
}
