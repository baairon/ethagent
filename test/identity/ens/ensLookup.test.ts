import test from 'node:test'
import assert from 'node:assert/strict'
import {
  discoverOwnedEnsNameDetails,
  encodeSetEthagentTextRecords,
  isEthDomain,
  normalizeEthDomain,
  parseAgentTokenReference,
  sanitizeSubdomainPrefix,
  splitSubdomainName,
  validateAgentEnsLink,
} from '../../../src/identity/ens/ensLookup.js'
import type { Address, PublicClient } from 'viem'

test('isEthDomain accepts only mainnet .eth names', () => {
  assert.equal(isEthDomain('example.eth'), true)
  assert.equal(isEthDomain('ethagent.example.eth'), true)
  assert.equal(isEthDomain('a.b.c.eth'), true)

  assert.equal(isEthDomain(''), false)
  assert.equal(isEthDomain('.eth'), false)
  assert.equal(isEthDomain('example'), false)
  assert.equal(isEthDomain('example.com'), false)
  assert.equal(isEthDomain('example eth'), false)
  assert.equal(isEthDomain('example.eth.fake'), false)
})

test('normalizeEthDomain trims, lowercases, strips trailing dots', () => {
  assert.equal(normalizeEthDomain(' Example.ETH. '), 'example.eth')
  assert.equal(normalizeEthDomain('Ethagent.Example.eth..'), 'ethagent.example.eth')
})

test('parseAgentTokenReference accepts ENS token pointers', () => {
  const parsed = parseAgentTokenReference('eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:45744')

  assert.equal(parsed?.chainId, 8453)
  assert.equal(parsed?.identityRegistryAddress, '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
  assert.equal(parsed?.agentId, 45_744n)
  assert.equal(parseAgentTokenReference('not-a-token-pointer'), null)
})

test('sanitizeSubdomainPrefix lowercases and replaces invalid characters', () => {
  assert.equal(sanitizeSubdomainPrefix('Hello World!'), 'hello-world')
  assert.equal(sanitizeSubdomainPrefix('--a__b--'), 'a-b')
  assert.equal(sanitizeSubdomainPrefix('AGENT.42'), 'agent-42')
  assert.equal(sanitizeSubdomainPrefix(''), '')
})

test('splitSubdomainName splits valid subdomains and rejects invalid ones', () => {
  assert.deepEqual(splitSubdomainName('ethagent.example.eth'), { label: 'ethagent', parent: 'example.eth' })
  assert.deepEqual(splitSubdomainName('a.b.c.eth'), { label: 'a', parent: 'b.c.eth' })

  assert.equal(splitSubdomainName('example.eth'), null, 'root .eth has no subdomain')
  assert.equal(splitSubdomainName('.eth'), null)
  assert.equal(splitSubdomainName('not-a-domain'), null)
  assert.equal(splitSubdomainName('bad..name.eth'), null)
})

test('agent ENS validation rejects root .eth names before lookup', async () => {
  const result = await validateAgentEnsLink(
    'example.eth',
    '0x0000000000000000000000000000000000000001' as `0x${string}`,
  )

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.reason, 'lookup-failed')
    assert.match(result.detail ?? '', /subdomain, not a root \.eth name/)
  }
})

test('agent ENS record writes reject root .eth names before lookup', async () => {
  await assert.rejects(
    encodeSetEthagentTextRecords('example.eth', { 'org.ethagent.profile': 'ipfs://bafy' }),
    /subdomain, not a root \.eth name/,
  )
})

test('ENS discovery returns the wallet primary name from the reverse resolver', async () => {
  const owner = '0x0000000000000000000000000000000000000001' as Address
  const fakeClient = {
    getEnsName: async () => 'myname.eth',
  } as unknown as PublicClient

  const result = await discoverOwnedEnsNameDetails(owner, {
    publicClient: fakeClient,
    rpcTimeoutMs: 1_000,
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.names, ['myname.eth'])
  assert.deepEqual(result.sourcesChecked, ['ENS reverse resolver'])
})

test('ENS discovery extracts the root parent when the primary name is a subdomain', async () => {
  const owner = '0x0000000000000000000000000000000000000001' as Address
  const fakeClient = {
    getEnsName: async () => 'agent.myname.eth',
  } as unknown as PublicClient

  const result = await discoverOwnedEnsNameDetails(owner, {
    publicClient: fakeClient,
    rpcTimeoutMs: 1_000,
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.names, ['myname.eth'])
})

test('ENS discovery returns an empty list when the wallet has no primary name', async () => {
  const owner = '0x0000000000000000000000000000000000000001' as Address
  const fakeClient = {
    getEnsName: async () => null,
  } as unknown as PublicClient

  const result = await discoverOwnedEnsNameDetails(owner, {
    publicClient: fakeClient,
    rpcTimeoutMs: 1_000,
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(result.names, [])
})

test('ENS discovery reports an error when the reverse-resolver lookup fails', async () => {
  const owner = '0x0000000000000000000000000000000000000001' as Address
  const failingClient = {
    getEnsName: async () => {
      throw new Error('rpc unavailable')
    },
  } as unknown as PublicClient

  const result = await discoverOwnedEnsNameDetails(owner, {
    publicClient: failingClient,
    rpcTimeoutMs: 1_000,
  })

  assert.equal(result.status, 'error')
  assert.deepEqual(result.names, [])
  assert.match(result.errors.join('\n'), /rpc unavailable/)
})
