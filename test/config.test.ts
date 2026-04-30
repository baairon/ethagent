import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { defaultModelFor, getConfigDir, getConfigPath, loadConfig } from '../src/storage/config.js'

test('default local model is the Hugging Face import placeholder', () => {
  assert.equal(defaultModelFor('llamacpp'), 'huggingface-link')
})

test('legacy Ollama configs load as local GGUF mode', async () => {
  await withTempHome(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    await fs.writeFile(getConfigPath(), JSON.stringify({
      version: 1,
      provider: 'ollama',
      model: 'qwen2.5-coder:7b',
      baseUrl: 'http://localhost:11434/v1',
      firstRunAt: new Date(0).toISOString(),
    }), 'utf8')

    const config = await loadConfig()

    assert.ok(config)
    assert.equal(config.provider, 'llamacpp')
    assert.equal(config.model, 'huggingface-link')
    assert.equal(config.baseUrl, 'http://localhost:8080/v1')
  })
})

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-config-'))
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
