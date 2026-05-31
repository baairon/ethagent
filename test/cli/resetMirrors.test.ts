import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectMemoryMirrorsUnder } from '../../src/cli/syncAdapters/claude-code.js'

test('projectMemoryMirrorsUnder finds every project MEMORY.md mirror, not just the current dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ethagent-mirrors-'))
  const mk = (slug: string): string => {
    const dir = join(root, 'projects', slug, 'memory')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'MEMORY.md')
    writeFileSync(file, '# MEMORY\nx\n')
    return file
  }
  const a = mk('proj-a')
  const b = mk('proj-b')
  mkdirSync(join(root, 'projects', 'proj-c', 'memory'), { recursive: true })

  const found = await projectMemoryMirrorsUnder(root)
  assert.deepEqual([...found].sort(), [a, b].sort())
})

test('projectMemoryMirrorsUnder returns empty when there is no projects directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ethagent-mirrors-empty-'))
  assert.deepEqual(await projectMemoryMirrorsUnder(root), [])
})
