import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { resetPlan, runReset } from '../../src/storage/reset.js'

test('resetPlan wipes the config dir + identity secret but preserves the pinata storage credential', () => {
  const plan = resetPlan()
  assert.equal(plan.configDir, path.join(os.homedir(), '.ethagent'))
  assert.deepEqual(plan.secretAccounts, ['ethereum:default'])
  assert.deepEqual(plan.preservedAccounts, ['pinata:jwt'])
})

test('runReset removes the config dir, clears identity secrets, and re-stores the preserved pinata credential', async () => {
  const removedDirs: string[] = []
  const clearedSecrets: string[] = []
  const reads: string[] = []
  const writes: Array<{ account: string; value: string }> = []
  const order: string[] = []
  const store: Record<string, string> = { 'pinata:jwt': 'jwt-abc', 'ethereum:default': 'eth-key' }
  const plan = await runReset({
    rm: async dir => { removedDirs.push(dir); order.push('rm') },
    removeSecret: async account => { clearedSecrets.push(account) },
    readSecret: async account => { reads.push(account); order.push(`read:${account}`); return store[account] ?? null },
    writeSecret: async (account, value) => { writes.push({ account, value }); order.push(`write:${account}`) },
  })
  assert.deepEqual(removedDirs, [plan.configDir])
  assert.deepEqual(clearedSecrets, ['ethereum:default'])
  assert.deepEqual(reads, ['pinata:jwt'])
  assert.deepEqual(writes, [{ account: 'pinata:jwt', value: 'jwt-abc' }])
  assert.ok(order.indexOf('read:pinata:jwt') < order.indexOf('rm'))
  assert.ok(order.indexOf('rm') < order.indexOf('write:pinata:jwt'))
})

test('runReset re-stores nothing when there is no pinata credential to preserve', async () => {
  const writes: string[] = []
  await runReset({
    rm: async () => {},
    removeSecret: async () => {},
    readSecret: async () => null,
    writeSecret: async account => { writes.push(account) },
  })
  assert.deepEqual(writes, [])
})
