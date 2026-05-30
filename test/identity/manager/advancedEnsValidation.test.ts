import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAdvancedEnsRelationship } from '../../../src/identity/manager/ens/advancedEnsValidation.js'
import type { Erc8004RegistryConfig } from '../../../src/identity/registry/erc8004.js'

const registry: Erc8004RegistryConfig = {
  chainId: 1,
  rpcUrl: 'https://example.com',
  identityRegistryAddress: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
}

const owner = '0x000000000000000000000000000000000000c01d' as const
const operator = '0x0000000000000000000000000000000000000A11' as const
const other = '0x0000000000000000000000000000000000000B0B' as const
const resolver = '0x0000000000000000000000000000000000001234' as const

function tokenClient(owner: string) {
  return {
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'ownerOf') return owner
      throw new Error(`unexpected token read: ${call.functionName}`)
    },
  } as any
}

function ensClient(args: { resolved: string | null }) {
  return {
    getEnsAddress: async () => args.resolved,
    readContract: async (call: { functionName: string }) => {
      if (call.functionName === 'owner') return owner
      if (call.functionName === 'resolver') return resolver
      throw new Error(`unexpected ENS read: ${call.functionName}`)
    },
  } as any
}

async function validate(args: {
  tokenOwner?: string
  ensResolved?: string | null
}) {
  return validateAdvancedEnsRelationship({
    fullName: 'agent.example.eth',
    ownerAddress: owner,
    registry,
    agentId: '42',
    tokenPublicClient: tokenClient(args.tokenOwner ?? owner),
    ensOptions: {
      publicClient: ensClient({
        resolved: args.ensResolved === undefined ? owner : args.ensResolved,
      }),
    },
  })
}

test('advanced ENS is valid when owner wallet owns token and ENS', async () => {
  const result = await validate({})
  assert.equal(result.ok, true)
})

test('advanced ENS rejects token owned by operator wallet instead of owner wallet', async () => {
  const result = await validate({ tokenOwner: operator })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'token-owner-mismatch')
})

test('advanced ENS rejects ENS resolving to operator wallet instead of owner wallet', async () => {
  const result = await validate({ ensResolved: operator })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'address-mismatch')
})

test('advanced ENS rejects ENS resolving to a different address than token owner', async () => {
  const result = await validate({ ensResolved: other })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.reason, 'address-mismatch')
})
