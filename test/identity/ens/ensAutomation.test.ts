import test from 'node:test'
import assert from 'node:assert/strict'
import { namehash, type Address } from 'viem'
import {
  ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET,
  encodeEnsRecordsTransaction,
  encodeEnsRegistryTransaction,
  preflightEnsSetup,
} from '../../../src/identity/ens/ensAutomation.js'
import type { Erc8004RegistryConfig } from '../../../src/identity/registry/erc8004.js'

const registry: Erc8004RegistryConfig = {
  chainId: 1,
  rpcUrl: 'https://example.com',
  identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
}

const root = 'example.eth'
const label = 'agent'
const fullName = `${label}.${root}`
const rootNode = namehash(root)
const fullNode = namehash(fullName)
const owner = '0x000000000000000000000000000000000000c01d' as Address
const operator = '0x0000000000000000000000000000000000000A11' as Address
const other = '0x0000000000000000000000000000000000000B0B' as Address
const resolver = '0x0000000000000000000000000000000000001234' as Address
const zero = '0x0000000000000000000000000000000000000000' as Address
const nameWrapper = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' as Address

function tokenClient(tokenOwner: Address = owner) {
  return {
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'ownerOf') return tokenOwner
      throw new Error(`unexpected token read: ${call.functionName}`)
    },
  } as any
}

function ensClient(args: {
  rootOwner?: Address
  parentResolver?: Address
  childOwner?: Address
  childResolver?: Address
  wrappedRootOwner?: Address
  wrappedChildOwner?: Address
  addressRecord?: Address
  texts?: Record<string, string>
}) {
  return {
    readContract: async (call: { address: Address; functionName: string; args: readonly unknown[] }) => {
      if (call.functionName === 'owner' && call.args[0] === rootNode) return args.rootOwner ?? owner
      if (call.functionName === 'resolver' && call.args[0] === rootNode) return args.parentResolver ?? resolver
      if (call.functionName === 'owner' && call.args[0] === fullNode) return args.childOwner ?? zero
      if (call.functionName === 'resolver' && call.args[0] === fullNode) return args.childResolver ?? zero
      if (call.functionName === 'ownerOf' && call.args[0] === BigInt(rootNode)) return args.wrappedRootOwner ?? owner
      if (call.functionName === 'ownerOf' && call.args[0] === BigInt(fullNode)) return args.wrappedChildOwner ?? owner
      if (call.functionName === 'addr') return args.addressRecord ?? zero
      if (call.functionName === 'text') return args.texts?.[String(call.args[1])] ?? ''
      throw new Error(`unexpected ENS read: ${call.functionName}`)
    },
  } as any
}

test('advanced ENS preflight creates direct registry setup and resolver records', async () => {
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({}),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.setup.registryAction, 'create-subdomain')
  assert.equal(result.ok && result.setup.mode, 'advanced')
  assert.equal(result.ok && result.setup.txCount, 2)
  if (!result.ok) return

  const registryTx = encodeEnsRegistryTransaction(result.setup)
  const recordsTx = encodeEnsRecordsTransaction(result.setup)
  assert.ok(registryTx?.data.startsWith('0x'))
  assert.equal(registryTx?.to, '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e')
  assert.equal(recordsTx?.to, ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET)
  assert.equal(recordsTx?.calls.length, 2)
})

test('simple ENS create preflight allows the connected wallet to own and operate the name', async () => {
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: owner,
    mode: 'simple',
    expectedOwnerAddress: owner,
    allowSameOwnerOperator: true,
    registry,
    agentId: '42',
    ensClient: ensClient({}),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.setup.mode, 'simple')
  assert.equal(result.setup.ownerAddress.toLowerCase(), owner.toLowerCase())
  assert.equal(result.setup.operatorAddress.toLowerCase(), owner.toLowerCase())
  assert.equal(result.setup.registryAction, 'create-subdomain')
})

test('advanced ENS preflight skips transactions when existing public records already match', async () => {
  const tokenRef = `eip155:1:${registry.identityRegistryAddress.toLowerCase()}:42`
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({
      childOwner: owner,
      childResolver: resolver,
      addressRecord: owner,
      texts: {
        'org.ethagent.token': tokenRef,
      },
    }),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.setup.registryAction, 'none')
  assert.equal(result.setup.txCount, 0)
  assert.equal(encodeEnsRegistryTransaction(result.setup), null)
  assert.equal(encodeEnsRecordsTransaction(result.setup), null)
})

test('advanced ENS preflight can set a missing resolver on an existing owner-owned subdomain', async () => {
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({ childOwner: owner, childResolver: zero }),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, true)
  assert.equal(result.ok && result.setup.registryAction, 'set-resolver')
  if (!result.ok) return
  assert.equal(encodeEnsRegistryTransaction(result.setup)?.to, '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e')
})

test('advanced ENS preflight blocks a subdomain already linked to another token', async () => {
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({
      childOwner: owner,
      childResolver: resolver,
      addressRecord: owner,
      texts: { 'org.ethagent.token': 'eip155:1:0xabc:99' },
    }),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.fallback.reason, 'token-record-collision')
})

test('advanced ENS preflight automates a NameWrapper-managed parent', async () => {
  const result = await preflightEnsSetup({
    rootName: root,
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({ rootOwner: nameWrapper, wrappedRootOwner: owner }),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.setup.registryAction, 'create-wrapped-subdomain')
  assert.equal(result.setup.resolverAddress, ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET)
  assert.equal(encodeEnsRegistryTransaction(result.setup)?.to, nameWrapper)
})

test('advanced ENS preflight rejects root names that are not parent .eth names', async () => {
  const result = await preflightEnsSetup({
    rootName: 'agent.example.eth',
    label,
    operatorAddress: operator,
    registry,
    agentId: '42',
    ensClient: ensClient({ rootOwner: other }),
    tokenPublicClient: tokenClient(),
  })

  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.fallback.reason, 'invalid-root')
})
