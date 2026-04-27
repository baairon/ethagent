import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTokenIdentity, getIdentityStatus, clearIdentity } from '../src/storage/identity.js'
import { saveConfig, type EthagentConfig } from '../src/storage/config.js'
import { getSecret, setSecret } from '../src/storage/secrets.js'

const IDENTITY_ACCOUNT = 'ethereum:default'

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-id-test-'))
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

const baseConfig = (): EthagentConfig => ({
  version: 1,
  provider: 'openai',
  model: 'gpt-test',
  firstRunAt: new Date(0).toISOString(),
})

test('setTokenIdentity persists ERC-8004 identity without a stored private key', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    const identity = {
      source: 'erc8004' as const,
      address: '0x000000000000000000000000000000000000dEaD',
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      chainId: 1,
      rpcUrl: 'https://ethereum.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: '42',
      agentUri: 'ipfs://bafy-agent',
      state: { name: 'agent' },
    }

    const updated = await setTokenIdentity(config, identity)
    const status = await getIdentityStatus(updated)

    assert.equal(status?.backend, 'browser-wallet')
    assert.equal(status?.agentId, '42')
    assert.equal(status?.chainId, 1)
    assert.equal(await getSecret(IDENTITY_ACCOUNT), null)
  })
})

test('clearIdentity removes ERC-8004 identity metadata without touching other config', async () => {
  await withTempHome(async () => {
    const config = {
      ...baseConfig(),
      selectedNetwork: 'base' as const,
      erc8004: {
        chainId: 8453,
        rpcUrl: 'https://base.publicnode.com',
        identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      },
    }
    await saveConfig(config)
    const identity = {
      source: 'erc8004' as const,
      address: '0x000000000000000000000000000000000000dEaD',
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      createdAt: new Date(0).toISOString(),
      chainId: 8453,
      rpcUrl: 'https://base.publicnode.com',
      identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
      agentId: '42',
      agentUri: 'ipfs://bafy-agent',
      state: { name: 'agent' },
    }
    const withToken = await setTokenIdentity(config, identity)

    const cleared = await clearIdentity(withToken)

    assert.equal(cleared.identity, undefined)
    assert.equal(cleared.provider, config.provider)
    assert.equal(cleared.model, config.model)
    assert.equal(cleared.selectedNetwork, 'base')
    assert.equal(cleared.erc8004?.chainId, 8453)
  })
})

test('clearIdentity also removes any legacy local private key secret', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    await setSecret(IDENTITY_ACCOUNT, 'legacy-private-key')
    assert.equal(await getSecret(IDENTITY_ACCOUNT), 'legacy-private-key')

    await clearIdentity({
      ...config,
      identity: {
        address: '0x000000000000000000000000000000000000dEaD',
        createdAt: new Date(0).toISOString(),
        source: 'local-key',
      },
    })

    assert.equal(await getSecret(IDENTITY_ACCOUNT), null)
  })
})
