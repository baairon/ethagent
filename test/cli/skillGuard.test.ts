import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { decideSkillGuard } from '../../src/cli/skillGuard.js'
import { claudeSkillsDir } from '../../src/cli/syncAdapters/claude-code.js'

test('decideSkillGuard denies writes inside the harness skills mirror when identity present', () => {
  const dir = claudeSkillsDir()
  assert.equal(decideSkillGuard(path.join(dir, 'foo', 'SKILL.md'), { identityPresent: true }).deny, true)
  assert.equal(decideSkillGuard(path.join(dir, 'foo', 'scripts', 'x.mjs'), { identityPresent: true }).deny, true)
  assert.equal(decideSkillGuard(dir, { identityPresent: true }).deny, true)
})

test('decideSkillGuard allows writes elsewhere', () => {
  assert.equal(decideSkillGuard(path.resolve('src/cli/sync.ts'), { identityPresent: true }).deny, false)
  assert.equal(
    decideSkillGuard(path.join(os.homedir(), '.claude', 'CLAUDE.md'), { identityPresent: true }).deny,
    false,
  )
})

test('decideSkillGuard does not match a sibling dir with a shared prefix', () => {
  const sibling = claudeSkillsDir() + '-archive'
  assert.equal(decideSkillGuard(path.join(sibling, 'x', 'SKILL.md'), { identityPresent: true }).deny, false)
})

test('decideSkillGuard allows when no identity is configured', () => {
  const dir = claudeSkillsDir()
  assert.equal(decideSkillGuard(path.join(dir, 'foo', 'SKILL.md'), { identityPresent: false }).deny, false)
})

test('decideSkillGuard allows when the file path is missing', () => {
  assert.equal(decideSkillGuard(null, { identityPresent: true }).deny, false)
  assert.equal(decideSkillGuard(undefined, { identityPresent: true }).deny, false)
})

test('decideSkillGuard deny carries a reason: read-only mirror, route adds directly to the vault skills dir', () => {
  const dir = claudeSkillsDir()
  const decision = decideSkillGuard(path.join(dir, 'foo', 'SKILL.md'), { identityPresent: true })
  assert.equal(decision.deny, true)
  assert.match(decision.reason ?? '', /vault/i)
  assert.match(decision.reason ?? '', /private by default/i)
  assert.match(decision.reason ?? '', /read-only/i)
  assert.match(decision.reason ?? '', /overwritten/i)
  assert.match(decision.reason ?? '', /--vault-dir/)
  assert.match(decision.reason ?? '', /directly/i)
})
