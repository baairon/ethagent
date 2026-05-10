import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicWriteText } from '../../src/storage/atomicWrite.js'

test('atomicWriteText writes the data and removes its temp file', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'data.txt')
    await atomicWriteText(file, 'hello world')
    assert.equal(await fs.readFile(file, 'utf8'), 'hello world')
    const leftover = (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(leftover, [], 'no .tmp files should remain after a successful write')
  })
})

test('concurrent atomicWriteText calls to the same target do not collide on tmp filename', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'meta.json')
    const writes = Array.from({ length: 20 }, (_, i) => atomicWriteText(file, `payload-${i}`))
    await Promise.all(writes)
    const final = await fs.readFile(file, 'utf8')
    assert.match(final, /^payload-\d+$/)
    const leftover = (await fs.readdir(dir)).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(leftover, [], 'no orphaned .tmp files after concurrent writes')
  })
})

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-atomic-'))
  try {
    await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}
