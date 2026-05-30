import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { decideMemoryGuard } from '../../src/cli/memoryGuard.js'
import { claudeCodeNativeMemoryDir } from '../../src/cli/syncAdapters/claude-code.js'

test('decideMemoryGuard denies writes inside the native memory dir when identity present', () => {
  const dir = claudeCodeNativeMemoryDir()
  assert.equal(decideMemoryGuard(path.join(dir, 'foo.md'), { identityPresent: true }).deny, true)
  assert.equal(decideMemoryGuard(path.join(dir, 'MEMORY.md'), { identityPresent: true }).deny, true)
  assert.equal(decideMemoryGuard(path.join(dir, 'sub', 'note.md'), { identityPresent: true }).deny, true)
  assert.equal(decideMemoryGuard(dir, { identityPresent: true }).deny, true)
})

test('decideMemoryGuard allows writes elsewhere', () => {
  assert.equal(decideMemoryGuard(path.resolve('src/cli/sync.ts'), { identityPresent: true }).deny, false)
  assert.equal(
    decideMemoryGuard(path.join(os.homedir(), '.claude', 'CLAUDE.md'), { identityPresent: true }).deny,
    false,
  )
})

test('decideMemoryGuard does not match a sibling dir with a shared prefix', () => {
  const sibling = claudeCodeNativeMemoryDir() + '-notes'
  assert.equal(decideMemoryGuard(path.join(sibling, 'x.md'), { identityPresent: true }).deny, false)
})

test('decideMemoryGuard allows when no identity is configured', () => {
  const dir = claudeCodeNativeMemoryDir()
  assert.equal(decideMemoryGuard(path.join(dir, 'foo.md'), { identityPresent: false }).deny, false)
})

test('decideMemoryGuard allows when the file path is missing', () => {
  assert.equal(decideMemoryGuard(null, { identityPresent: true }).deny, false)
  assert.equal(decideMemoryGuard(undefined, { identityPresent: true }).deny, false)
})

test('decideMemoryGuard deny carries a redirect reason pointing at the markers', () => {
  const dir = claudeCodeNativeMemoryDir()
  const decision = decideMemoryGuard(path.join(dir, 'foo.md'), { identityPresent: true })
  assert.equal(decision.deny, true)
  assert.match(decision.reason ?? '', /ethagent:memory:start/)
  assert.match(decision.reason ?? '', /ethagent:soul:start/)
  assert.match(decision.reason ?? '', /CLAUDE\.md/)
})
