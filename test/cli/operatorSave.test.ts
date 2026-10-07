import test from 'node:test'
import assert from 'node:assert/strict'
import { runOperatorSave, type RunOperatorSaveDeps } from '../../src/cli/operatorSave.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import { multiCustodyIdentity } from '../identity/manager/effects/effects.fixtures.js'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const IDENTITY = {
  ...multiCustodyIdentity,
  rpcUrl: 'https://mainnet.base.org',
  state: { ...multiCustodyIdentity.state, operatorVaultAddress: '0x6bdC0000000000000000000000000000000051d7' },
} as EthagentIdentity

const PUBLISHED: EthagentIdentity = {
  ...IDENTITY,
  agentUri: 'ipfs://meta-new',
  metadataCid: 'meta-new',
  backup: {
    cid: 'snap-new', createdAt: '2026-10-06T00:00:00.000Z', envelopeVersion: '1',
    ipfsApiUrl: 'https://uploads.pinata.cloud/v3/files', status: 'pinned', txHash: '0xabc', metadataCid: 'meta-new',
  },
}

type Spies = { pulls: number; sends: number; saved: EthagentConfig[] }

function deps(spies: Spies, overrides: Partial<RunOperatorSaveDeps> = {}): RunOperatorSaveDeps {
  return {
    readOperatorKey: () => ({ ok: true, key: KEY, address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }) as never,
    loadConfig: async () => ({ version: 2, firstSeenAt: '', identity: IDENTITY }),
    saveConfig: async config => { spies.saved.push(config) },
    resolveValidatedPinataJwt: async () => 'jwt',
    continuityVaultStatus: async () => ({ ready: true, files: {} as never }),
    continuityWorkingTreeStatus: async () => ({ ready: true, localChangedAfterBackup: true, publishState: 'local-changes' }) as never,
    listPublishedContinuitySnapshots: async () => [],
    pullHarnessSoulMemoryIntoVault: async () => { spies.pulls++; return [] },
    runOperatorWalletRebackup: async args => {
      spies.sends++
      await args.callbacks.onIdentityComplete(PUBLISHED, 'saved', 'update')
    },
    createSigner: () => (async () => { throw new Error('the fake rebackup never signs') }) as never,
    discoverOwnedAgentBackupByTokenId: async () => ({ backup: { cid: 'snap-new' } }) as never,
    ...overrides,
  }
}

async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const orig = process.stdout.write
  let out = ''
  process.stdout.write = ((chunk: unknown) => { out += String(chunk); return true }) as typeof process.stdout.write
  try {
    return { result: await fn(), out }
  } finally {
    process.stdout.write = orig
  }
}

test('operator-save pulls the tools\' edits, publishes, and verifies the onchain pointer', async () => {
  const spies: Spies = { pulls: 0, sends: 0, saved: [] }
  const { result, out } = await capture(() => runOperatorSave(['--json'], deps(spies)))
  assert.equal(result, 0)
  const json = JSON.parse(out.trim())
  assert.equal(json.schema, 1)
  assert.equal(json.published, true)
  assert.equal(json.verification, 'verified')
  assert.equal(spies.pulls, 1)
  assert.equal(spies.sends, 1)
  assert.equal(spies.saved.length, 1)
})

test('operator-save sends nothing when nothing changed since the last snapshot', async () => {
  const spies: Spies = { pulls: 0, sends: 0, saved: [] }
  const quiet = deps(spies, {
    continuityWorkingTreeStatus: async () => ({ ready: true, localChangedAfterBackup: false, publishState: 'published' }) as never,
  })
  const { result, out } = await capture(() => runOperatorSave(['--json'], quiet))
  assert.equal(result, 0)
  assert.deepEqual(JSON.parse(out.trim()), { schema: 1, ok: true, skipped: true, reason: 'no-local-changes' })
  assert.equal(spies.pulls, 1, 'the tools\' edits are pulled before deciding')
  assert.equal(spies.sends, 0)
})

test('operator-save reports a pointer that does not resolve to the new snapshot yet', async () => {
  const spies: Spies = { pulls: 0, sends: 0, saved: [] }
  const lagging = deps(spies, { discoverOwnedAgentBackupByTokenId: async () => ({ backup: { cid: 'snap-old' } }) as never })
  const { out } = await capture(() => runOperatorSave(['--json'], lagging))
  assert.equal(JSON.parse(out.trim()).verification, 'mismatch')
})

test('operator-save exits 3 without a key and never pins', async () => {
  const spies: Spies = { pulls: 0, sends: 0, saved: [] }
  const noKey = deps(spies, { readOperatorKey: () => ({ ok: false, reason: 'missing' }) as never })
  const { result, out } = await capture(() => runOperatorSave(['--json'], noKey))
  assert.equal(result, 3)
  assert.equal(JSON.parse(out.trim()).schema, 1)
  assert.equal(spies.sends, 0)
})
