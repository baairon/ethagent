import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  clearModelCatalogCache,
  discoverProviderModels,
  isOpenAIOAuthAllowedModel,
  OPENAI_OAUTH_DEFAULT_MODEL,
} from '../../src/models/catalog.js'
import { createProvider } from '../../src/providers/registry.js'
import { setOpenAIOAuthCredentials } from '../../src/auth/openaiOAuth/credentials.js'
import type { EthagentConfig } from '../../src/storage/config.js'
import type { StreamEvent } from '../../src/providers/contracts.js'

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-oauth-gating-test-'))
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

const baseConfig: EthagentConfig = {
  version: 1,
  provider: 'openai',
  model: 'o4-mini',
  firstRunAt: new Date(0).toISOString(),
}

const sseCompleted = (): string => 'event: response.completed\ndata: {"response":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n'

test('OPENAI_OAUTH_DEFAULT_MODEL is gpt-5.4', () => {
  assert.equal(OPENAI_OAUTH_DEFAULT_MODEL, 'gpt-5.4')
})

test('isOpenAIOAuthAllowedModel accepts only Codex-supported ChatGPT-account models', () => {
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5.5'), true)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5.4'), true)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5.4-mini'), true)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5.3-codex'), true)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5.2'), true)

  assert.equal(isOpenAIOAuthAllowedModel('gpt-5-codex'), false)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-5'), false)
  assert.equal(isOpenAIOAuthAllowedModel('o4-mini'), false)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-4o'), false)
  assert.equal(isOpenAIOAuthAllowedModel('gpt-4.1'), false)
  assert.equal(isOpenAIOAuthAllowedModel(''), false)
})

test('OAuth-only catalog exposes only Codex-supported models', async () => {
  await withTempHome(async () => {
    clearModelCatalogCache()
    await setOpenAIOAuthCredentials({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      accountId: 'acc',
      expiresAt: Date.now() + 3_600_000,
      lastRefreshAt: Date.now(),
    })

    const result = await discoverProviderModels(baseConfig, {
      loadKey: async () => null,
      now: () => 0,
    })

    assert.equal(result.status, 'ok')
    assert.deepEqual(result.entries.map(e => e.id), ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'])
    for (const forbidden of ['o4-mini', 'gpt-4o', 'gpt-4.1', 'gpt-5-codex', 'gpt-5']) {
      assert.ok(!result.entries.some(e => e.id === forbidden), `${forbidden} should not be in OAuth catalog`)
    }
  })
})

test('OpenAI routing provider snaps disallowed model to gpt-5.4 when OAuth is active', async () => {
  await withTempHome(async () => {
    clearModelCatalogCache()
    await setOpenAIOAuthCredentials({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      accountId: 'acc',
      expiresAt: Date.now() + 3_600_000,
      lastRefreshAt: Date.now(),
    })

    const originalFetch = globalThis.fetch
    let observedModel: unknown
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      observedModel = body?.model
      return new Response(sseCompleted(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const provider = createProvider({ ...baseConfig, model: 'gpt-5-codex' })
      const events: StreamEvent[] = []
      for await (const event of provider.complete([{ role: 'user', content: 'hi' }], new AbortController().signal)) {
        events.push(event)
      }

      assert.equal(observedModel, 'gpt-5.4')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

test('OpenAI routing provider preserves allowed model under OAuth', async () => {
  await withTempHome(async () => {
    clearModelCatalogCache()
    await setOpenAIOAuthCredentials({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'id',
      accountId: 'acc',
      expiresAt: Date.now() + 3_600_000,
      lastRefreshAt: Date.now(),
    })

    const originalFetch = globalThis.fetch
    let observedModel: unknown
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      observedModel = body?.model
      return new Response(sseCompleted(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch

    try {
      const provider = createProvider({ ...baseConfig, model: 'gpt-5.5' })
      for await (const _ of provider.complete([{ role: 'user', content: 'hi' }], new AbortController().signal)) { void _ }

      assert.equal(observedModel, 'gpt-5.5')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
