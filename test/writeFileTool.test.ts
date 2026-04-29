import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeToolWithPermissions } from '../src/runtime/toolExecution.js'
import type { EthagentConfig } from '../src/storage/config.js'

async function runWrite(cwd: string, input: Record<string, unknown>, config?: EthagentConfig) {
  return executeToolWithPermissions({
    name: 'write_file',
    input,
    permissionMode: 'accept-edits',
    cwd,
    config,
    getPermissionRules: () => [],
    requestPermission: async () => 'allow-once',
    onDirectoryChange: () => {},
  })
}

test('write_file creates a new file', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-write-'))

  const outcome = await runWrite(cwd, { path: 'index.html', content: '<h1>Hello</h1>\n' })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'index.html'), 'utf8'), '<h1>Hello</h1>\n')
})

test('write_file allows writing to an existing file without explicit overwrite', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-write-'))
  await fs.writeFile(path.join(cwd, 'index.html'), '<h1>Keep</h1>\n', 'utf8')

  const outcome = await runWrite(cwd, { path: 'index.html', content: '<h1>Replace</h1>\n' })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'index.html'), 'utf8'), '<h1>Replace</h1>\n')
})

test('write_file overwrites existing files only with explicit overwrite', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-write-'))
  await fs.writeFile(path.join(cwd, 'index.html'), '<h1>Old</h1>\n', 'utf8')

  const outcome = await runWrite(cwd, {
    path: 'index.html',
    content: '<h1>New</h1>\n',
    overwrite: true,
  })

  assert.equal(outcome.result.ok, true)
  assert.equal(await fs.readFile(path.join(cwd, 'index.html'), 'utf8'), '<h1>New</h1>\n')
})

test('write_file rejects shell-command-shaped paths', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-write-'))

  const outcome = await runWrite(cwd, { path: 'rm -rf index.html', content: '<h1>No</h1>\n' })

  assert.equal(outcome.result.ok, false)
  assert.match(outcome.result.content, /shell command/i)
})

test('write_file refuses private continuity markdown when identity is linked', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-write-'))
  const outcome = await runWrite(cwd, { path: 'MEMORY.md', content: '# Memory\n' }, identityConfig())

  assert.equal(outcome.result.ok, false)
  assert.equal(outcome.result.summary, 'write_file failed before execution')
  assert.match(outcome.result.content, /propose_private_continuity_edit/)
  await assert.rejects(() => fs.readFile(path.join(cwd, 'MEMORY.md'), 'utf8'), /ENOENT/)
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
