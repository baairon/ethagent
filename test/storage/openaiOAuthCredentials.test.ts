import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getOpenAIOAuthCredentials,
  hasOpenAIOAuthCredentials,
  rmOpenAIOAuthCredentials,
  setOpenAIOAuthCredentials,
  type OpenAIOAuthCredentials,
} from '../../src/auth/openaiOAuth/credentials.js'

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-oauth-test-'))
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  try {
    await fn()
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    await fs.rm(dir, { recursive: true, force: true })
  }
}

const sampleCreds = (): OpenAIOAuthCredentials => ({
  accessToken: 'at-abc',
  refreshToken: 'rt-xyz',
  idToken: 'id-token',
  accountId: 'acc-1',
  expiresAt: 1_700_000_000_000,
  lastRefreshAt: 1_699_999_000_000,
})

test('OpenAI OAuth credentials round-trip JSON through the secret store', async () => {
  await withTempHome(async () => {
    assert.equal(await hasOpenAIOAuthCredentials(), false)
    assert.equal(await getOpenAIOAuthCredentials(), null)

    const creds = sampleCreds()
    await setOpenAIOAuthCredentials(creds)

    assert.equal(await hasOpenAIOAuthCredentials(), true)
    const fetched = await getOpenAIOAuthCredentials()
    assert.deepEqual(fetched, creds)
  })
})

test('OpenAI OAuth credentials clear removes the slot', async () => {
  await withTempHome(async () => {
    await setOpenAIOAuthCredentials(sampleCreds())
    assert.equal(await hasOpenAIOAuthCredentials(), true)
    await rmOpenAIOAuthCredentials()
    assert.equal(await hasOpenAIOAuthCredentials(), false)
    assert.equal(await getOpenAIOAuthCredentials(), null)
  })
})

test('OpenAI OAuth credentials reject malformed payloads', async () => {
  await withTempHome(async () => {
    const { setSecret } = await import('../../src/storage/secrets.js')
    await setSecret('openai-oauth', 'not-json-at-all')
    assert.equal(await getOpenAIOAuthCredentials(), null)

    await setSecret('openai-oauth', JSON.stringify({ accessToken: 'a' }))
    assert.equal(await getOpenAIOAuthCredentials(), null)
  })
})

test('setSecret throws a diagnostic message when value is not a string', async () => {
  await withTempHome(async () => {
    const { setSecret } = await import('../../src/storage/secrets.js')
    await assert.rejects(
      () => setSecret('test-slot', undefined as unknown as string),
      /setSecret\(test-slot\): value is undefined/,
    )
    await assert.rejects(
      () => setSecret('test-slot', '   '),
      /setSecret\(test-slot\): value is empty/,
    )
  })
})
