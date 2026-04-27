import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreTokenSelectionStep, runRebackupUri } from '../src/identity/identityHubEffects.js'
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

test('rebackup URI refuses to publish an unverified metadata pin', async () => {
  await assert.rejects(
    runRebackupUri({
      kind: 'rebackup-uri',
      identity: {
        source: 'erc8004',
        address: '0x000000000000000000000000000000000000dEaD',
        ownerAddress: '0x000000000000000000000000000000000000dEaD',
        createdAt: new Date(0).toISOString(),
        agentId: '1',
      },
      registry,
      agentUri: 'ipfs://bafy-unverified',
      metadataCid: 'bafy-unverified',
      metadataPin: { cid: 'bafy-unverified', pinVerified: false, provider: 'pinata' },
      backup: {
        cid: 'bafy-state',
        createdAt: new Date(0).toISOString(),
        envelopeVersion: 'ethagent-pq-backup-v1',
        ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files',
        status: 'pinned',
        ownerAddress: '0x000000000000000000000000000000000000dEaD',
      },
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
    }, {
      onStep: () => {},
      onWalletReady: () => {},
      onIdentityComplete: async () => {},
    }),
    /IPFS pin was not verified/,
  )
})
