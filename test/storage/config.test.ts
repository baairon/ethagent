import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  ConfigVersionStaleError,
  defaultModelFor,
  getConfigDir,
  getConfigPath,
  getConfiguredVaultAddress,
  loadConfig,
  normalizeConfig,
  saveConfig,
  saveConfigGuarded,
  saveConfigWithMerge,
  setConfiguredVaultAddress,
  type EthagentConfig,
} from '../../src/storage/config.js'

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

test('getConfiguredVaultAddress returns undefined when no map is set', () => {
  const cfg = baseConfig()
  assert.equal(getConfiguredVaultAddress(cfg, 8453), undefined)
  assert.equal(getConfiguredVaultAddress(null, 8453), undefined)
  assert.equal(getConfiguredVaultAddress(undefined, 8453), undefined)
})

test('setConfiguredVaultAddress + getConfiguredVaultAddress round-trip per chain', () => {
  const cfg = baseConfig()
  const vault8453 = '0x1111111111111111111111111111111111111111'
  const vault1 = '0x2222222222222222222222222222222222222222'
  const cfg1 = setConfiguredVaultAddress(cfg, 8453, vault8453)
  const cfg2 = setConfiguredVaultAddress(cfg1, 1, vault1)
  assert.equal(getConfiguredVaultAddress(cfg2, 8453), vault8453)
  assert.equal(getConfiguredVaultAddress(cfg2, 1), vault1)
})

test('setConfiguredVaultAddress does not mutate the input config', () => {
  const cfg = baseConfig()
  const vault = '0x1111111111111111111111111111111111111111'
  const next = setConfiguredVaultAddress(cfg, 8453, vault)
  assert.notEqual(next, cfg)
  assert.equal(cfg.erc8004?.operatorVaults, undefined, 'original config should be untouched')
})

test('setConfiguredVaultAddress throws when the registry config is missing', () => {
  const cfg: EthagentConfig = {
    version: 1,
    provider: 'llamacpp',
    model: 'huggingface-link',
    firstRunAt: new Date(0).toISOString(),
  }
  assert.throws(() => setConfiguredVaultAddress(cfg, 8453, '0x1111111111111111111111111111111111111111'))
})

test('saveConfig + loadConfig round-trip the operatorVaults map', async () => {
  await withTempHome(async () => {
    const cfg = setConfiguredVaultAddress(
      baseConfig(),
      8453,
      '0x1111111111111111111111111111111111111111',
    )
    await saveConfig(cfg)
    const reloaded = await loadConfig()
    assert.ok(reloaded)
    assert.equal(
      getConfiguredVaultAddress(reloaded, 8453),
      '0x1111111111111111111111111111111111111111',
    )
  })
})

test('normalizeConfig backfills erc8004 from identity chain info when absent', () => {
  const cfg: EthagentConfig = {
    version: 1,
    provider: 'llamacpp',
    model: 'huggingface-link',
    firstRunAt: new Date(0).toISOString(),
    identity: {
      address: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      source: 'erc8004',
      chainId: 8453,
      rpcUrl: 'https://base.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    },
  }
  const next = normalizeConfig(cfg)
  assert.equal(next.erc8004?.chainId, 8453)
  assert.equal(next.erc8004?.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
  assert.equal(next.erc8004?.rpcUrl, 'https://base.publicnode.com')
})

test('normalizeConfig leaves erc8004 untouched when already set', () => {
  const cfg: EthagentConfig = {
    version: 1,
    provider: 'llamacpp',
    model: 'huggingface-link',
    firstRunAt: new Date(0).toISOString(),
    identity: {
      address: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      source: 'erc8004',
      chainId: 8453,
      rpcUrl: 'https://base.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    },
    erc8004: {
      chainId: 1,
      rpcUrl: 'https://ethereum.publicnode.com',
      identityRegistryAddress: '0x0000000000000000000000000000000000000001',
      operatorVaults: { '1': '0x1111111111111111111111111111111111111111' },
    },
  }
  const next = normalizeConfig(cfg)
  assert.equal(next.erc8004?.chainId, 1)
  assert.equal(next.erc8004?.operatorVaults?.['1'], '0x1111111111111111111111111111111111111111')
})

test('saveConfig increments configVersion on every write', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    const first = await loadConfig()
    assert.ok(first)
    assert.equal(first.configVersion, 1)
    await saveConfig(first)
    const second = await loadConfig()
    assert.ok(second)
    assert.equal(second.configVersion, 2)
  })
})

test('saveConfigGuarded throws ConfigVersionStaleError when on-disk version advanced past base', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    const base = await loadConfig()
    assert.ok(base)
    await saveConfig(base)
    const drifted = setConfiguredVaultAddress(base, 8453, '0x3333333333333333333333333333333333333333')
    await assert.rejects(() => saveConfigGuarded(base, drifted), (err: unknown) => err instanceof ConfigVersionStaleError)
  })
})

test('saveConfigWithMerge re-applies the patch against fresh on-disk state when version drifts', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    const v1 = await loadConfig()
    assert.ok(v1)
    let patchCalls = 0
    const persisted = await saveConfigWithMerge(current => {
      patchCalls += 1
      if (patchCalls === 1 && current) {
        return setConfiguredVaultAddress(current, 8453, '0xaaa1111111111111111111111111111111111111')
      }
      throw new Error('unexpected attempt count')
    })
    assert.equal(patchCalls, 1)
    assert.equal(persisted.erc8004?.operatorVaults?.['8453'], '0xaaa1111111111111111111111111111111111111')
  })
})

test('saveConfigWithMerge retries against the new on-disk state after a concurrent write', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    const initial = await loadConfig()
    assert.ok(initial)
    let patchCalls = 0
    const persisted = await saveConfigWithMerge(async current => {
      patchCalls += 1
      if (patchCalls === 1) {
        const concurrent = await loadConfig()
        assert.ok(concurrent)
        await saveConfig(concurrent)
      }
      assert.ok(current)
      return setConfiguredVaultAddress(current, 8453, '0xbbb2222222222222222222222222222222222222')
    })
    assert.equal(patchCalls, 2)
    assert.equal(persisted.erc8004?.operatorVaults?.['8453'], '0xbbb2222222222222222222222222222222222222')
  })
})

test('saveConfigWithMerge surfaces ConfigVersionStaleError after exhausting attempts', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    let patchCalls = 0
    await assert.rejects(
      () => saveConfigWithMerge(async current => {
        patchCalls += 1
        const concurrent = await loadConfig()
        assert.ok(concurrent)
        await saveConfig(concurrent)
        assert.ok(current)
        return setConfiguredVaultAddress(current, 8453, '0xccc3333333333333333333333333333333333333')
      }, 2),
      (err: unknown) => err instanceof ConfigVersionStaleError,
    )
    assert.equal(patchCalls, 2)
  })
})

test('saveConfigWithMerge propagates non-stale errors immediately without retry', async () => {
  await withTempHome(async () => {
    const cfg = baseConfig()
    await saveConfig(cfg)
    let patchCalls = 0
    await assert.rejects(
      () => saveConfigWithMerge(() => {
        patchCalls += 1
        throw new Error('synthetic non-stale failure')
      }),
      (err: unknown) => err instanceof Error && /synthetic non-stale/.test(err.message),
    )
    assert.equal(patchCalls, 1)
  })
})

test('normalizeConfig is a no-op when identity chain info is incomplete', () => {
  const cfg: EthagentConfig = {
    version: 1,
    provider: 'llamacpp',
    model: 'huggingface-link',
    firstRunAt: new Date(0).toISOString(),
    identity: {
      address: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      source: 'local-key',
    },
  }
  const next = normalizeConfig(cfg)
  assert.equal(next.erc8004, undefined)
})

function baseConfig(): EthagentConfig {
  return {
    version: 1,
    provider: 'llamacpp',
    model: 'huggingface-link',
    firstRunAt: new Date(0).toISOString(),
    erc8004: {
      chainId: 8453,
      rpcUrl: 'https://example.invalid/rpc',
      identityRegistryAddress: '0x8004A169fb4a3325136Eb29fA0CEB6D2e539a432',
    },
  }
}

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
