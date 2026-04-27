import test from 'node:test'
import assert from 'node:assert/strict'
import type { EthagentConfig } from '../src/storage/config.js'
import { registryConfigFromConfig, resolveSelectedNetwork } from '../src/identity/registryConfig.js'

const baseConfig: EthagentConfig = {
  version: 1,
  provider: 'openai',
  model: 'gpt-5.2',
  firstRunAt: new Date(0).toISOString(),
}

test('resolveSelectedNetwork defaults to mainnet when nothing is set', () => {
  assert.equal(resolveSelectedNetwork(undefined), 'mainnet')
  assert.equal(resolveSelectedNetwork(baseConfig), 'mainnet')
})

test('resolveSelectedNetwork reads selectedNetwork preference', () => {
  assert.equal(resolveSelectedNetwork({ ...baseConfig, selectedNetwork: 'base' }), 'base')
})

test('resolveSelectedNetwork falls back to inferring from erc8004.chainId', () => {
  const config: EthagentConfig = {
    ...baseConfig,
    erc8004: {
      chainId: 42161,
      rpcUrl: 'https://arbitrum-one.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    },
  }
  assert.equal(resolveSelectedNetwork(config), 'arbitrum')
})

test('mainnet resolves with default registry, no override needed', () => {
  const result = registryConfigFromConfig(baseConfig)
  assert.equal(result.network, 'mainnet')
  assert.equal(result.chainId, 1)
  assert.equal(result.needsRegistryAddress, false)
  assert.ok(result.config)
  assert.equal(result.config?.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
  assert.equal(result.config?.rpcUrl, 'https://ethereum.publicnode.com')
})

test('L2 without override resolves with the shared default registry', () => {
  const result = registryConfigFromConfig({ ...baseConfig, selectedNetwork: 'base' })
  assert.equal(result.network, 'base')
  assert.equal(result.chainId, 8453)
  assert.equal(result.needsRegistryAddress, false)
  assert.ok(result.config)
  assert.equal(result.config?.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
  assert.equal(result.defaultRpcUrl, 'https://mainnet.base.org')
})

test('L2 with matching erc8004 override resolves cleanly', () => {
  const result = registryConfigFromConfig({
    ...baseConfig,
    selectedNetwork: 'arbitrum',
    erc8004: {
      chainId: 42161,
      rpcUrl: 'https://arbitrum-one.publicnode.com',
      identityRegistryAddress: '0x1111111111111111111111111111111111111111',
    },
  })
  assert.equal(result.network, 'arbitrum')
  assert.equal(result.needsRegistryAddress, false)
  assert.equal(result.config?.identityRegistryAddress, '0x1111111111111111111111111111111111111111')
})

test('erc8004 override for a different chain than selectedNetwork is ignored', () => {
  // selectedNetwork=base but erc8004 override is for mainnet — the override does not apply.
  const result = registryConfigFromConfig({
    ...baseConfig,
    selectedNetwork: 'base',
    erc8004: {
      chainId: 1,
      rpcUrl: 'https://ethereum.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    },
  })
  assert.equal(result.network, 'base')
  assert.equal(result.needsRegistryAddress, false)
  assert.equal(result.config?.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
})
