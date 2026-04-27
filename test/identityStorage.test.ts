import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setIdentity, setTokenIdentity, getIdentityStatus, getPrivateKey, clearIdentity } from '../src/storage/identity.js'
import { saveConfig, getConfigPath, getConfigDir, type EthagentConfig } from '../src/storage/config.js'
import { generatePrivateKey, addressFromPrivateKey } from '../src/identity/eth.js'

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

test('setIdentity persists the address but never the private key in config.json', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    const pk = generatePrivateKey()
    const expected = addressFromPrivateKey(pk)

    const { config: updated, identity } = await setIdentity(pk, config)
    assert.equal(updated.identity?.address, expected)
    assert.equal(identity.address, expected)

    const raw = await fs.readFile(getConfigPath(), 'utf8')
    const stripped = pk.startsWith('0x') ? pk.slice(2) : pk
    assert.equal(raw.includes(stripped), false, 'private key must not appear in config.json')
    assert.equal(raw.includes(expected), true, 'address must appear in config.json')
  })
})

test('getPrivateKey + getIdentityStatus round-trip', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    const pk = generatePrivateKey()
    const { config: updated } = await setIdentity(pk, config)

    const status = await getIdentityStatus(updated)
    assert.ok(status, 'identity status should be present')
    assert.equal(status?.address, updated.identity?.address)
    assert.match(status?.backend ?? '', /^(keyring|encrypted-file)$/)

    const stored = await getPrivateKey()
    assert.equal((stored ?? '').toLowerCase(), pk.toLowerCase())
  })
})

test('clearIdentity removes both config field and stored secret', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    const pk = generatePrivateKey()
    const { config: withId } = await setIdentity(pk, config)
    assert.ok(withId.identity)

    const cleared = await clearIdentity(withId)
    assert.equal(cleared.identity, undefined)

    const status = await getIdentityStatus(cleared)
    assert.equal(status, null)
    const stored = await getPrivateKey()
    assert.equal(stored, null)
  })
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
    assert.equal(await getPrivateKey(), null)
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

test('private key never lands in plaintext anywhere under ~/.ethagent/', async () => {
  await withTempHome(async () => {
    const config = baseConfig()
    await saveConfig(config)
    const pk = generatePrivateKey()
    const stripped = pk.startsWith('0x') ? pk.slice(2) : pk
    await setIdentity(pk, config)

    const dir = getConfigDir()
    const entries = await fs.readdir(dir)
    for (const entry of entries) {
      const full = path.join(dir, entry)
      const stat = await fs.stat(full)
      if (!stat.isFile()) continue
      const buf = await fs.readFile(full)
      const text = buf.toString('utf8')
      assert.equal(
        text.toLowerCase().includes(stripped.toLowerCase()),
        false,
        `private key must not appear in ${entry}`,
      )
    }
  })
})
