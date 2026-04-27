import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clearPinataJwt,
  getPinataJwt,
  hasPinataJwt,
  invalidatePinataJwtCache,
  resolvePinataJwt,
  savePinataJwt,
} from '../src/identity/pinataJwt.js'

const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwaW5hdGEifQ.signature'

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-pinata-'))
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const prevEnvJwt = process.env.PINATA_JWT
  process.env.HOME = dir
  process.env.USERPROFILE = dir
  delete process.env.PINATA_JWT
  invalidatePinataJwtCache()
  try {
    await fn()
  } finally {
    await clearPinataJwt().catch(() => {})
    invalidatePinataJwtCache()
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    if (prevEnvJwt === undefined) delete process.env.PINATA_JWT
    else process.env.PINATA_JWT = prevEnvJwt
    await fs.rm(dir, { recursive: true, force: true })
  }
}

test('savePinataJwt rejects non-JWT strings via extractPinataJwt', async () => {
  await withTempHome(async () => {
    await assert.rejects(savePinataJwt('not a token'), /Paste the JWT from Pinata/)
    await assert.rejects(savePinataJwt('API Key: f6ce52d7aecdace366d'), /Use the JWT, not the API key or secret/)
  })
})

test('savePinataJwt persists the JWT and round-trips through get/has/resolve', async () => {
  await withTempHome(async () => {
    assert.equal(await hasPinataJwt(), false)
    const { jwt } = await savePinataJwt(TEST_JWT)
    assert.equal(jwt, TEST_JWT)
    assert.equal(await hasPinataJwt(), true)
    assert.equal(await getPinataJwt(), TEST_JWT)
    assert.equal(await resolvePinataJwt(), TEST_JWT)
  })
})

test('savePinataJwt extracts a JWT from copy-all paste', async () => {
  await withTempHome(async () => {
    const blob = ['API Key', 'f6ce52d7aecdace366d', 'JWT', TEST_JWT].join('\n')
    const { jwt } = await savePinataJwt(blob)
    assert.equal(jwt, TEST_JWT)
    assert.equal(await resolvePinataJwt(), TEST_JWT)
  })
})

test('clearPinataJwt removes the secret and updates the cache', async () => {
  await withTempHome(async () => {
    await savePinataJwt(TEST_JWT)
    assert.equal(await resolvePinataJwt(), TEST_JWT)
    await clearPinataJwt()
    assert.equal(await hasPinataJwt(), false)
    assert.equal(await resolvePinataJwt(), undefined)
  })
})

test('resolvePinataJwt falls back to PINATA_JWT env when no secret is stored', async () => {
  await withTempHome(async () => {
    process.env.PINATA_JWT = 'env-fallback-jwt'
    invalidatePinataJwtCache()
    try {
      assert.equal(await resolvePinataJwt(), 'env-fallback-jwt')
    } finally {
      delete process.env.PINATA_JWT
    }
  })
})

test('stored JWT takes precedence over PINATA_JWT env', async () => {
  await withTempHome(async () => {
    process.env.PINATA_JWT = 'env-fallback-jwt'
    invalidatePinataJwtCache()
    try {
      await savePinataJwt(TEST_JWT)
      assert.equal(await resolvePinataJwt(), TEST_JWT)
    } finally {
      delete process.env.PINATA_JWT
    }
  })
})
