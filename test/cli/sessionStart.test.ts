import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSessionStartContext } from '../../src/cli/sessionStart.js'

test('session start context points at both marker pairs in CLAUDE.md', () => {
  const ctx = buildSessionStartContext()
  assert.match(ctx, /ethagent:memory:start/)
  assert.match(ctx, /ethagent:memory:end/)
  assert.match(ctx, /ethagent:soul:start/)
  assert.match(ctx, /ethagent:soul:end/)
  assert.match(ctx, /CLAUDE\.md/)
})

test('session start context forbids the native memory directory', () => {
  const ctx = buildSessionStartContext()
  assert.match(ctx, /native memory directory/)
  assert.match(ctx, /do not travel/)
})

test('session start context warns the skills mirror is read-only and routes adds to the vault dir', () => {
  const ctx = buildSessionStartContext()
  assert.match(ctx, /skills/i)
  assert.match(ctx, /~\/\.claude\/skills/)
  assert.match(ctx, /read-only/i)
  assert.match(ctx, /--vault-dir/)
  assert.match(ctx, /directly/i)
})

test('session start context names the concrete vault skills path when an identity is present', () => {
  const ctx = buildSessionStartContext({
    address: '0xabc',
    createdAt: '2026-01-01',
    chainId: 8453,
    identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    agentId: '45744',
  })
  assert.match(ctx, /\.ethagent/)
  assert.match(ctx, /continuity/)
  assert.match(ctx, /skills/)
})
