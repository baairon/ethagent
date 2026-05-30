import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { resetPlan, runReset } from '../../src/storage/reset.js'

test('resetPlan targets the ethagent config dir and the identity + pinata secrets', () => {
  const plan = resetPlan()
  assert.equal(plan.configDir, path.join(os.homedir(), '.ethagent'))
  assert.deepEqual(plan.secretAccounts, ['ethereum:default', 'pinata:jwt'])
})

test('runReset removes the config dir then clears each secret account', async () => {
  const removedDirs: string[] = []
  const clearedSecrets: string[] = []
  const plan = await runReset({
    rm: async dir => { removedDirs.push(dir) },
    removeSecret: async account => { clearedSecrets.push(account) },
  })
  assert.deepEqual(removedDirs, [plan.configDir])
  assert.deepEqual(clearedSecrets, ['ethereum:default', 'pinata:jwt'])
})
