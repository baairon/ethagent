import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertTokenNotInVault,
  TokenInVaultError,
} from '../../../../src/identity/hub/custody/preflight.js'
import { identityFixture, registry } from './effects.fixtures.js'

test('assertTokenNotInVault returns void when identity has no agentId yet', async () => {
  await assertTokenNotInVault({
    identity: { ...identityFixture },
    registry,
  })
})

test('assertTokenNotInVault returns void when no Vault is deployed for the chain', async () => {
  const identityWithToken = {
    ...identityFixture,
    chainId: registry.chainId,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId: '42',
  }
  await assertTokenNotInVault({
    identity: identityWithToken,
    registry,
    client: { readContract: async () => { throw new Error('client should not be called') } } as never,
  })
})

test('assertTokenNotInVault throws TokenInVaultError when the token is held by Vault', async () => {
  const VAULT = '0x00000000000000000000000000000000000077AB' as `0x${string}`
  const identityWithToken = {
    ...identityFixture,
    chainId: registry.chainId,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId: '42',
    state: {
      custodyMode: 'advanced',
      operatorVaultAddress: VAULT,
    },
  }
  const client = {
    readContract: async () => '0x00000000000000000000000000000000000000c0' as `0x${string}`,
  }
  await assert.rejects(
    assertTokenNotInVault({ identity: identityWithToken, registry, client: client as never }),
    (err: unknown) => err instanceof TokenInVaultError,
  )
})

test('assertTokenNotInVault returns void when Vault reports the token is not held', async () => {
  const VAULT = '0x00000000000000000000000000000000000077AB' as `0x${string}`
  const identityWithToken = {
    ...identityFixture,
    chainId: registry.chainId,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId: '42',
    state: {
      custodyMode: 'advanced',
      operatorVaultAddress: VAULT,
    },
  }
  const client = {
    readContract: async () => '0x0000000000000000000000000000000000000000' as `0x${string}`,
  }
  await assertTokenNotInVault({ identity: identityWithToken, registry, client: client as never })
})
