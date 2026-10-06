import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { getAddress, type Address, type Hex } from 'viem'
import { runRestoreCommand, type RestoreSeams } from '../../src/cli/onchain/restore.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import type { Erc8004AgentCandidate } from '../../src/identity/registry/erc8004.js'
import { createContinuitySnapshotChallenge, createContinuitySnapshotEnvelope } from '../../src/identity/continuity/envelope.js'
import { addressFromPrivateKey, generatePrivateKey, signMessage } from '../../src/identity/crypto/eth.js'
import { runRestoreAuthorize } from '../../src/identity/manager/restore/apply.js'
import { continuityVaultRef } from '../../src/identity/continuity/storage/paths.js'
import { captureIo, withHome, type CapturedIo } from '../support/home.js'

const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const CID = 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'

function candidateFor(owner: Address, extra: Partial<Erc8004AgentCandidate> = {}): Erc8004AgentCandidate {
  return {
    ownerAddress: owner,
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: REGISTRY,
    agentId: 45744n,
    agentUri: 'ipfs://bafymetadata',
    name: 'meow',
    backup: { cid: CID, createdAt: '2026-10-01T00:00:00.000Z' } as Erc8004AgentCandidate['backup'],
    registration: null,
    ...extra,
  }
}

function envelopeFor(key: Hex) {
  const owner = addressFromPrivateKey(key)
  return createContinuitySnapshotEnvelope({
    ownerAddress: owner,
    walletSignature: signMessage(key, createContinuitySnapshotChallenge(owner)),
    payload: {
      createdAt: '2026-10-01T00:00:00.000Z',
      agent: { chainId: 8453, agentId: '45744' },
      files: { 'SOUL.md': '# SOUL.md\n- Voice: calm\n', 'MEMORY.md': '# MEMORY.md\n- restored rule\n' },
      transcript: [],
      state: {},
    },
  })
}

function deps(config: EthagentConfig | null, operatorKey?: HistoryDeps['operatorKey']): HistoryDeps & { io: CapturedIo } {
  return {
    io: captureIo(),
    env: {},
    now: () => new Date('2026-10-06T00:00:00.000Z'),
    loadConfig: async () => config,
    listLedger: async () => [],
    ...(operatorKey ? { operatorKey } : {}),
  }
}

function seams(candidate: Erc8004AgentCandidate, envelope: ReturnType<typeof envelopeFor>, saved: EthagentConfig[] = []): RestoreSeams {
  return {
    resolveTokenId: async () => ({ ok: true, candidate }),
    resolveEns: async () => ({ ok: true, candidate }),
    ensTokenChain: async () => 8453,
    discoverOwner: async () => [candidate],
    latestCandidate: async () => candidate,
    fetchEnvelope: async () => ({ kind: 'restore-authorizing', cid: CID, apiUrl: 'https://uploads.pinata.cloud/v3/files', envelope, candidate }),
    authorize: runRestoreAuthorize,
    refetch: async () => { throw new Error('refetch must not run here') },
    localChanges: async () => false,
    openSession: async () => { throw new Error('the operator key must never open a browser') },
    openExternal: () => {},
    saveConfig: async config => { saved.push(config) },
  }
}

test('restore <token-id> previews without writing and names the signer', async () => {
  await withHome(async () => {
    const key = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(key))
    const d = deps(null, { ok: true, key, address: owner })
    const saved: EthagentConfig[] = []
    const code = await runRestoreCommand(['45744', '--network', 'base', '--operator', '--json'], d, seams(candidateFor(owner), envelopeFor(key), saved))
    assert.equal(code, 0)
    const out = d.io.json() as Record<string, any>
    assert.equal(out.applied, false)
    assert.equal(out.action, 'restore')
    assert.equal(out.agent.agentId, '45744')
    assert.deepEqual(out.signer, { kind: 'operator', address: owner })
    assert.equal(saved.length, 0)
  })
})

test('restore --operator --yes decrypts locally, writes the vault, and saves config last', async () => {
  await withHome(async () => {
    const key = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(key))
    const d = deps(null, { ok: true, key, address: owner })
    const saved: EthagentConfig[] = []
    const candidate = candidateFor(owner)
    const code = await runRestoreCommand(['45744', '--network', 'base', '--operator', '--yes', '--json'], d, seams(candidate, envelopeFor(key), saved))
    assert.equal(code, 0, d.io.stdout() + d.io.stderr())
    assert.equal(d.io.json().applied, true)
    assert.equal(saved.length, 1)
    const identity = saved[0]!.identity as EthagentIdentity
    assert.equal(identity.agentId, '45744')
    assert.equal(saved[0]!.erc8004?.chainId, 8453)
    const memory = await fs.readFile(continuityVaultRef(identity).memoryPath, 'utf8')
    assert.match(memory, /restored rule/)
  })
})

test('restore --operator refuses with exit 3 when the snapshot has no slot for the key', async () => {
  await withHome(async () => {
    const ownerKey = generatePrivateKey() as Hex
    const operatorKey = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(ownerKey))
    const operator = getAddress(addressFromPrivateKey(operatorKey))
    const candidate = candidateFor(owner, {
      operators: { approvedOperatorWallets: [{ address: operator }], activeOperatorAddress: operator } as Erc8004AgentCandidate['operators'],
    })
    const d = deps(null, { ok: true, key: operatorKey, address: operator })
    const code = await runRestoreCommand(['45744', '--network', 'base', '--operator', '--yes', '--json'], d, seams(candidate, envelopeFor(ownerKey)))
    assert.equal(code, 3)
    assert.match(String(d.io.json().error), /no restore slot/)
  })
})

test('restore refuses an operator key that is neither owner nor approved', async () => {
  await withHome(async () => {
    const ownerKey = generatePrivateKey() as Hex
    const strangerKey = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(ownerKey))
    const stranger = getAddress(addressFromPrivateKey(strangerKey))
    const d = deps(null, { ok: true, key: strangerKey, address: stranger })
    assert.equal(await runRestoreCommand(['45744', '--network', 'base', '--operator', '--json'], d, seams(candidateFor(owner), envelopeFor(ownerKey))), 1)
    assert.match(String(d.io.json().error), /neither the owner/)
  })
})

test('restore usage: a token id needs a network, no identity needs a target, keys need injecting', async () => {
  await withHome(async () => {
    const key = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(key))
    const s = seams(candidateFor(owner), envelopeFor(key))
    const noNetwork = deps(null)
    assert.equal(await runRestoreCommand(['45744', '--json'], noNetwork, s), 2)
    assert.match(String(noNetwork.io.json().hint), /--network/)
    const noTarget = deps(null)
    assert.equal(await runRestoreCommand(['--json'], noTarget, s), 2)
    const missingKey = deps(null, { ok: false, reason: 'missing' })
    assert.equal(await runRestoreCommand(['45744', '--network', 'base', '--operator', '--json'], missingKey, s), 3)
    const badKey = deps(null, { ok: false, reason: 'invalid' })
    assert.equal(await runRestoreCommand(['45744', '--network', 'base', '--operator', '--json'], badKey, s), 2)
    const badNetwork = deps(null)
    assert.equal(await runRestoreCommand(['45744', '--network', 'optimism', '--json'], badNetwork, s), 2)
  })
})

test('restore --owner lists agents read-only', async () => {
  await withHome(async () => {
    const key = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(key))
    const d = deps(null)
    assert.equal(await runRestoreCommand(['--owner', owner, '--json'], d, seams(candidateFor(owner), envelopeFor(key))), 0)
    const agents = d.io.json().agents as Array<Record<string, unknown>>
    assert.equal(agents[0]!.agentId, '45744')
    assert.equal(agents[0]!.network, 'base')
  })
})

test('restore with an identity previews a refetch and warns about local changes', async () => {
  await withHome(async () => {
    const key = generatePrivateKey() as Hex
    const owner = getAddress(addressFromPrivateKey(key))
    const identity = {
      source: 'erc8004', address: owner, ownerAddress: owner, createdAt: '2026-01-01T00:00:00.000Z',
      chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY, agentId: '45744', agentUri: 'ipfs://x', state: {},
    } as EthagentIdentity
    const d = deps({ version: 2, firstSeenAt: identity.createdAt, identity } as EthagentConfig)
    const s = { ...seams(candidateFor(owner), envelopeFor(key)), localChanges: async () => true }
    assert.equal(await runRestoreCommand(['--json'], d, s), 0)
    const out = d.io.json() as Record<string, any>
    assert.equal(out.action, 'refetch')
    assert.match(out.warnings.join('\n'), /local changes/)
  })
})
