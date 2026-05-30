import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { isManagedCorePath } from '../../src/cli/sync.js'
import { continuityVaultRef } from '../../src/identity/continuity/storage.js'
import type { EthagentIdentity } from '../../src/storage/config.js'

const identity: EthagentIdentity = {
  source: 'erc8004',
  address: '0x000000000000000000000000000000000000dEaD',
  ownerAddress: '0x000000000000000000000000000000000000dEaD',
  createdAt: new Date(0).toISOString(),
  chainId: 1,
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
  agentId: '42',
}

test('isManagedCorePath matches the vault SOUL.md and MEMORY.md', () => {
  const ref = continuityVaultRef(identity)
  assert.equal(isManagedCorePath(identity, ref.soulPath), true)
  assert.equal(isManagedCorePath(identity, ref.memoryPath), true)
})

test('isManagedCorePath matches the claude-code harness file', () => {
  const claudeMd = path.join(os.homedir(), '.claude', 'CLAUDE.md')
  assert.equal(isManagedCorePath(identity, claudeMd), true)
})

test('isManagedCorePath ignores unrelated edits', () => {
  assert.equal(isManagedCorePath(identity, path.resolve('src/cli/sync.ts')), false)
  assert.equal(isManagedCorePath(identity, path.join(os.homedir(), '.claude', 'settings.json')), false)
})

test('isManagedCorePath is path-normalized, not string-exact', () => {
  const ref = continuityVaultRef(identity)
  const messy = path.join(ref.dir, '.', 'SOUL.md')
  assert.equal(isManagedCorePath(identity, messy), true)
})
