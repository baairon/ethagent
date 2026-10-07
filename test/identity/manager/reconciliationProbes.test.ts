import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { probeAgentUri, probeCustody } from '../../../src/identity/manager/shared/reconciliation/agentReconciliation/run.js'
import type { EthagentIdentity } from '../../../src/storage/config.js'

const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const OWNER = getAddress('0xA1E9000000000000000000000000000000000001')
const VAULT = getAddress('0x6bdC0000000000000000000000000000000051d7')
const registry = { chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY }

function identity(extra: Partial<EthagentIdentity> = {}, state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    address: OWNER, ownerAddress: OWNER, createdAt: '', agentId: '45744', agentUri: 'ipfs://local',
    state: { custodyMode: 'advanced', ...state }, ...extra,
  } as EthagentIdentity
}

function client(reads: Record<string, unknown>): never {
  return {
    readContract: async (call: { functionName: string }) => {
      if (!(call.functionName in reads)) throw new Error(`reverted: ${call.functionName}`)
      return reads[call.functionName]
    },
  } as never
}

test('the agent URI probe reads tokenURI, the registry\'s own pointer', async () => {
  const args = { registry, agentId: 45744n }
  assert.equal((await probeAgentUri({ ...args, identity: identity(), client: client({ tokenURI: 'ipfs://local' }) })).kind, 'in-sync')
  assert.equal((await probeAgentUri({ ...args, identity: identity(), client: client({ agentURI: 'ipfs://local' }) })).kind, 'unknown')
})

test('a differing pointer is the chain\'s unless a pinned snapshot is waiting here', async () => {
  const args = { registry, agentId: 45744n, client: client({ tokenURI: 'ipfs://other-machine' }) }
  assert.equal((await probeAgentUri({ ...args, identity: identity() })).kind, 'chain-newer')
  const pending = identity({ metadataCid: 'bafy-new', backup: { cid: 'bafy-snap', metadataCid: 'bafy-old' } as never })
  assert.equal((await probeAgentUri({ ...args, identity: pending })).kind, 'local-newer')
})

test('custody is mid-flow only while the Vault holds the token and this machine has not saved Advanced', async () => {
  const args = { registry, agentId: 45744n, expectedOwner: OWNER, vaultAddress: VAULT, client: client({ agentOwner: OWNER }) }
  assert.equal((await probeCustody({ ...args, identity: identity() })).kind, 'advanced')
  assert.equal((await probeCustody({ ...args, identity: identity({}, { custodyMode: 'simple' }) })).kind, 'mid-flow-uri-pending')
  const empty = { ...args, client: client({ agentOwner: '0x0000000000000000000000000000000000000000' }) }
  assert.equal((await probeCustody({ ...empty, identity: identity() })).kind, 'withdrawn')
})
