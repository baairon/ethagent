import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkForUpdates,
  compareVersions,
  formatUpdateNotice,
  isNewerVersion,
} from '../../src/cli/updateNotice.js'

test('update notice compares semantic versions instead of any mismatch', () => {
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1)
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1)
  assert.equal(compareVersions('1.1.0', '1.1.0'), 0)
  assert.equal(isNewerVersion('1.0.9', '1.1.0'), false)
  assert.equal(isNewerVersion('1.1.1', '1.1.0'), true)
})

test('update notice is hidden for npm-linked local versions newer than the registry', () => {
  assert.equal(formatUpdateNotice('1.1.0', '1.0.9'), null)
})

test('update notice includes current and latest versions only when latest is newer', async () => {
  const notice = await checkForUpdates('1.1.0', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ version: '1.1.1' }),
    }),
    timeoutMs: 1,
  })

  assert.equal(notice, '✨ update available: ethagent 1.1.0 -> 1.1.1 · run npm i -g ethagent@latest')
})

test('update notice fails closed for registry errors', async () => {
  const notice = await checkForUpdates('1.1.0', {
    fetchImpl: async () => {
      throw new Error('offline')
    },
    timeoutMs: 1,
  })

  assert.equal(notice, null)
})
