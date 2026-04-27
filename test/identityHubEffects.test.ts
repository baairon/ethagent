import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreTokenSelectionStep } from '../src/identity/identityHubEffects.js'
import type { Erc8004AgentCandidate, Erc8004RegistryConfig } from '../src/identity/erc8004.js'

const registry: Erc8004RegistryConfig = {
  chainId: 1,
  rpcUrl: 'https://example.com',
  identityRegistryAddress: '0x0000000000000000000000000000000000000001',
}

function candidate(agentId: bigint, cid?: string): Erc8004AgentCandidate {
  return {
    ownerAddress: '0x000000000000000000000000000000000000dEaD',
    chainId: registry.chainId,
    rpcUrl: registry.rpcUrl,
    identityRegistryAddress: registry.identityRegistryAddress,
    agentId,
    agentUri: `ipfs://agent-${agentId.toString()}`,
    registration: null,
    ...(cid ? { backup: { cid, createdAt: new Date(0).toISOString() } } : {}),
  }
}

test('restore discovery requires confirmation even when one ERC-8004 agent is found', () => {
  const step = restoreTokenSelectionStep({
    ownerHandle: 'owner.eth',
    registry,
    candidates: [candidate(1n, 'bafy-state')],
    purpose: 'restore',
  })

  assert.equal(step.kind, 'restore-select-token')
  assert.equal(step.candidates.length, 1)
  assert.equal(step.candidates[0]?.backup?.cid, 'bafy-state')
})

test('restore discovery lists every restorable ERC-8004 agent and excludes unrecoverable tokens', () => {
  const step = restoreTokenSelectionStep({
    ownerHandle: 'owner.eth',
    registry,
    candidates: [candidate(1n, 'bafy-one'), candidate(2n), candidate(3n, 'bafy-three')],
    purpose: 'restore',
  })

  assert.deepEqual(step.candidates.map(item => item.agentId), [1n, 3n])
  assert.deepEqual(step.candidates.map(item => item.backup?.cid), ['bafy-one', 'bafy-three'])
})
