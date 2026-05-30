import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getConfigDir,
  getConfigPath,
  getConfiguredVaultAddress,
  loadConfig,
  normalizeConfig,
  saveConfig,
  setConfiguredVaultAddress,
  type EthagentConfig,
} from '../../src/storage/config.js'

test('legacy v1 with identity preserves the identity block during migration', async () => {
  await withTempHome(async () => {
    await fs.mkdir(getConfigDir(), { recursive: true })
    await fs.writeFile(getConfigPath(), JSON.stringify({
      version: 1,
      provider: 'llamacpp',
      model: 'huggingface-link',
      firstRunAt: new Date(0).toISOString(),
      identity: {
        address: '0x000000000000000000000000000000000000dEaD',
        createdAt: new Date(0).toISOString(),
        source: 'erc8004',
        chainId: 1,
        rpcUrl: 'https://ethereum.publicnode.com',
        identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
        agentId: '42',
      },
    }), 'utf8')

    const config = await loadConfig()

    assert.ok(config)
    assert.equal(config.version, 2)
    assert.equal(config.identity?.agentId, '42')
    assert.equal(config.identity?.source, 'erc8004')
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
    version: 2,
    firstSeenAt: new Date(0).toISOString(),
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
    version: 2,
    firstSeenAt: new Date(0).toISOString(),
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
    version: 2,
    firstSeenAt: new Date(0).toISOString(),
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

test('normalizeConfig is a no-op when identity chain info is incomplete', () => {
  const cfg: EthagentConfig = {
    version: 2,
    firstSeenAt: new Date(0).toISOString(),
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
    version: 2,
    firstSeenAt: new Date(0).toISOString(),
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
