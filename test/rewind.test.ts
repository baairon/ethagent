import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('rewind entries stay scoped to the requested workspace and page in newest-first order', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home

  const workspaceA = path.join(home, 'workspace-a')
  const workspaceB = path.join(home, 'workspace-b')
  await fs.mkdir(workspaceA, { recursive: true })
  await fs.mkdir(workspaceB, { recursive: true })

  const rewind = await import('../src/storage/rewind.js')

  await rewind.recordRewindSnapshot({
    workspaceRoot: workspaceA,
    filePath: path.join(workspaceA, 'a.txt'),
    existedBefore: true,
    previousContent: 'old-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    promptSnippet: 'edit a',
    checkpointLabel: 'edit a',
  })
  await rewind.recordRewindSnapshot({
    workspaceRoot: workspaceB,
    filePath: path.join(workspaceB, 'b.txt'),
    existedBefore: true,
    previousContent: 'old-b',
    createdAt: '2026-01-01T00:00:01.000Z',
    promptSnippet: 'edit b',
    checkpointLabel: 'edit b',
  })
  await rewind.recordRewindSnapshot({
    workspaceRoot: workspaceA,
    filePath: path.join(workspaceA, 'nested', 'c.txt'),
    existedBefore: false,
    previousContent: '',
    createdAt: '2026-01-01T00:00:02.000Z',
    promptSnippet: 'create c',
    checkpointLabel: 'create c',
  })

  const entries = await rewind.listRewindEntries(workspaceA, { limit: 10, offset: 0 })

  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.relativePath.replaceAll('\\', '/'), 'nested/c.txt')
  assert.equal(entries[1]?.relativePath.replaceAll('\\', '/'), 'a.txt')
  assert.ok(entries.every(entry => entry.workspaceRoot === path.resolve(workspaceA)))
})
