import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
  chainIdForNetwork,
  networkForChainId,
  normalizeErc8004RegistryConfig,
  supportedErc8004ChainForId,
  SUPPORTED_ERC8004_CHAINS,
} from '../../../src/identity/registry/erc8004.js'

test('SUPPORTED_ERC8004_CHAINS is the curated set: Ethereum Mainnet and Base', () => {
  assert.equal(SUPPORTED_ERC8004_CHAINS.length, 2)
  assert.deepEqual(
    SUPPORTED_ERC8004_CHAINS.map(c => c.network),
    ['mainnet', 'base'],
  )
})

test('chainIdForNetwork maps every curated network', () => {
  assert.equal(chainIdForNetwork('mainnet'), 1)
  assert.equal(chainIdForNetwork('base'), 8453)
})

test('networkForChainId reverses the mapping', () => {
  assert.equal(networkForChainId(1), 'mainnet')
  assert.equal(networkForChainId(8453), 'base')
  assert.equal(networkForChainId(99999), undefined)
})

test('every curated network uses the shared ERC-8004 registry address', () => {
  for (const chain of SUPPORTED_ERC8004_CHAINS) {
    assert.equal(chain.identityRegistryAddress, DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS)
  }
})

test('normalize uses shared registry defaults on Base without an override', () => {
  const cfg = normalizeErc8004RegistryConfig({ chainId: 8453 })
  assert.equal(cfg.chainId, 8453)
  assert.equal(cfg.identityRegistryAddress, DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS)
  assert.equal(cfg.rpcUrl, 'https://mainnet.base.org')
  assert.deepEqual(supportedErc8004ChainForId(8453)?.fallbackRpcUrls, ['https://base.publicnode.com'])
})

test('normalize uses mainnet defaults when chainId is omitted', () => {
  const cfg = normalizeErc8004RegistryConfig({})
  assert.equal(cfg.chainId, 1)
  assert.equal(cfg.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
})
