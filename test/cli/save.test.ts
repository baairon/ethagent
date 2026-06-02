import test from 'node:test'
import assert from 'node:assert/strict'
import { runSave, type RunSaveDeps } from '../../src/cli/save.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'

const IDENTITY: EthagentIdentity = {
  address: `0x${'a'.repeat(40)}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  source: 'erc8004',
  chainId: 8453,
  rpcUrl: 'https://mainnet.base.org',
  identityRegistryAddress: `0x${'b'.repeat(40)}`,
  agentId: '45744',
}

const CONFIG: EthagentConfig = {
  version: 2,
  firstSeenAt: '2026-01-01T00:00:00.000Z',
  identity: IDENTITY,
}

const COMPLETED: EthagentIdentity = {
  ...IDENTITY,
  agentUri: 'ipfs://meta-cid',
  metadataCid: 'meta-cid',
  backup: {
    cid: 'snap-cid',
    createdAt: '2026-06-01T00:00:00.000Z',
    envelopeVersion: '1',
    ipfsApiUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
    status: 'pinned',
    txHash: '0xabc123',
  },
}

const LOCAL_ONLY_PIN: EthagentIdentity = {
  ...IDENTITY,
  backup: {
    cid: 'snap-cid-local',
    createdAt: '2026-06-01T00:00:00.000Z',
    envelopeVersion: '1',
    ipfsApiUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
    status: 'pinned',
  },
}
const OPERATOR_PENDING_MESSAGE = 'Snapshot saved locally. Owner wallet still needs to publish to rotate the onchain pointer.'

const VAULT_PUBLISHED: EthagentIdentity = {
  ...IDENTITY,
  agentUri: 'ipfs://meta-cid-2',
  metadataCid: 'meta-cid-2',
  backup: {
    cid: 'snap-cid-2',
    createdAt: '2026-06-01T00:00:00.000Z',
    envelopeVersion: '1',
    ipfsApiUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
    status: 'pinned',
    metadataCid: 'meta-cid-2',
  },
}

const PENDING_PUBLISH: EthagentIdentity = {
  ...IDENTITY,
  metadataCid: 'old-meta-cid',
  agentUri: 'ipfs://old-meta-cid',
  backup: {
    cid: 'pinned-not-published-cid',
    createdAt: '2026-06-01T00:00:00.000Z',
    envelopeVersion: '1',
    ipfsApiUrl: 'https://api.pinata.cloud/pinning/pinFileToIPFS',
    status: 'pinned',
  },
}

type Spies = { saved: EthagentConfig[]; rebackupCalls: number; opened: string[]; pulls: number }
const freshSpies = (): Spies => ({ saved: [], rebackupCalls: 0, opened: [], pulls: 0 })

function makeDeps(spies: Spies, overrides: Partial<RunSaveDeps> = {}): RunSaveDeps {
  const base: RunSaveDeps = {
    loadConfig: async () => CONFIG,
    saveConfig: async c => { spies.saved.push(c) },
    resolveValidatedPinataJwt: async () => 'jwt-token',
    continuityVaultStatus: async () => ({ ready: true, files: {} as never }),
    continuityWorkingTreeStatus: async () => ({
      ready: true,
      localChangedAfterBackup: true,
      publishState: 'local-changes',
    }),
    listPublishedContinuitySnapshots: async () => [],
    runRebackupSigning: async (_step, cb) => {
      spies.rebackupCalls++
      cb.onWalletReady({ url: 'http://localhost:9999/' })
      await cb.onIdentityComplete(COMPLETED, 'done', 'update')
    },
    openExternalUrl: url => { spies.opened.push(url) },
    pullHarnessSoulMemoryIntoVault: async () => { spies.pulls++; return [] },
    discoverOwnedAgentBackupByTokenId: async () => ({ backup: { cid: 'snap-cid' } }) as never,
  }
  return { ...base, ...overrides }
}

async function withCapturedOutput<T>(fn: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const origOut = process.stdout.write
  const origErr = process.stderr.write
  let out = ''
  let err = ''
  process.stdout.write = ((chunk: unknown) => { out += String(chunk); return true }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => { err += String(chunk); return true }) as typeof process.stderr.write
  try {
    const result = await fn()
    return { result, out, err }
  } finally {
    process.stdout.write = origOut
    process.stderr.write = origErr
  }
}

test('save: no identity returns 1 and never opens the wallet', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, { loadConfig: async () => null })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 1)
  assert.equal(spies.rebackupCalls, 0)
  assert.equal(spies.opened.length, 0)
})

test('save: identity without an agent token id returns 1', async () => {
  const spies = freshSpies()
  const { agentId: _drop, ...noAgent } = IDENTITY
  const deps = makeDeps(spies, { loadConfig: async () => ({ ...CONFIG, identity: noAgent }) })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 1)
  assert.equal(spies.rebackupCalls, 0)
})

test('save: continuity not restored returns 1 and never opens the wallet', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, { continuityVaultStatus: async () => ({ ready: false, files: {} as never }) })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 1)
  assert.equal(spies.rebackupCalls, 0)
  assert.equal(spies.opened.length, 0)
})

test('save: no local changes is a no-op (no wallet, returns 0)', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    continuityWorkingTreeStatus: async () => ({
      ready: true,
      localChangedAfterBackup: false,
      publishState: 'published',
    }),
  })
  const { result, out } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 0)
  assert.equal(spies.rebackupCalls, 0)
  assert.equal(spies.opened.length, 0)
  assert.equal(spies.saved.length, 0)
  assert.match(out, /nothing to save/i)
})

test('save: a pending publish (pinned but pointer not rotated) is NOT skipped even when content is unchanged', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    loadConfig: async () => ({ ...CONFIG, identity: PENDING_PUBLISH }),
    continuityWorkingTreeStatus: async () => ({
      ready: true,
      localChangedAfterBackup: false,
      publishState: 'published',
    }),
    runRebackupSigning: async (_step, cb) => {
      spies.rebackupCalls++
      cb.onWalletReady({ url: 'http://localhost:9999/' } as never)
      await cb.onIdentityComplete(VAULT_PUBLISHED, 'Snapshot published onchain through the Vault.', 'update')
    },
  })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 0)
  assert.equal(spies.rebackupCalls, 1)
})

test('save: no local changes with --json reports skipped', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    continuityWorkingTreeStatus: async () => ({
      ready: true,
      localChangedAfterBackup: false,
      publishState: 'published',
    }),
  })
  const { result, out } = await withCapturedOutput(() => runSave(['--json'], deps))
  assert.equal(result, 0)
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.skipped, true)
  assert.equal(parsed.reason, 'no-local-changes')
  assert.equal(spies.rebackupCalls, 0)
})

test('save: missing Pinata JWT returns 3 and never opens the wallet', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, { resolveValidatedPinataJwt: async () => undefined })
  const { result, err } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 3)
  assert.equal(spies.rebackupCalls, 0)
  assert.equal(spies.opened.length, 0)
  assert.match(err, /IPFS storage credential/i)
})

test('save: invalid Pinata JWT returns 3 and never opens the wallet', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    resolveValidatedPinataJwt: async () => { throw new Error('Pinata rejected this JWT') },
  })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 3)
  assert.equal(spies.rebackupCalls, 0)
  assert.equal(spies.opened.length, 0)
})

test('save: unknown option returns 2', async () => {
  const spies = freshSpies()
  const { result } = await withCapturedOutput(() => runSave(['--bogus'], makeDeps(spies)))
  assert.equal(result, 2)
})

test('save: success persists the merged identity, opens the wallet, returns 0', async () => {
  const spies = freshSpies()
  const { result } = await withCapturedOutput(() => runSave([], makeDeps(spies)))
  assert.equal(result, 0)
  assert.equal(spies.rebackupCalls, 1)
  assert.equal(spies.opened.length, 1)
  assert.equal(spies.saved.length, 1)
  assert.equal(spies.saved[0]?.identity?.backup?.cid, 'snap-cid')
})

test('save: pulls harness soul/memory into the vault before snapshotting', async () => {
  const spies = freshSpies()
  const { result } = await withCapturedOutput(() => runSave([], makeDeps(spies)))
  assert.equal(result, 0)
  assert.equal(spies.pulls, 1)
  assert.equal(spies.rebackupCalls, 1)
})

test('save: --no-open succeeds without opening the browser', async () => {
  const spies = freshSpies()
  const { result } = await withCapturedOutput(() => runSave(['--no-open'], makeDeps(spies)))
  assert.equal(result, 0)
  assert.equal(spies.opened.length, 0)
  assert.equal(spies.saved.length, 1)
})

test('save: --json success emits a JSON result line', async () => {
  const spies = freshSpies()
  const { result, out } = await withCapturedOutput(() => runSave(['--json'], makeDeps(spies)))
  assert.equal(result, 0)
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.cid, 'snap-cid')
  assert.equal(parsed.txHash, '0xabc123')
})

test('save: wallet cancellation returns 3 and saves nothing', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    runRebackupSigning: async () => { throw new Error('wallet request was cancelled') },
  })
  const { result } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 3)
  assert.equal(spies.saved.length, 0)
})

test('save: operator local-only pin is reported as pending (not published) and returns 4', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    runRebackupSigning: async (_step, cb) => {
      spies.rebackupCalls++
      cb.onWalletReady({ url: 'http://localhost:9999/' } as never)
      await cb.onIdentityComplete(LOCAL_ONLY_PIN, OPERATOR_PENDING_MESSAGE, 'update')
    },
  })
  const { result, out, err } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 4)
  assert.equal(spies.saved.length, 1)
  assert.doesNotMatch(out, /published onchain/i)
  assert.match(out, /owner/i)
  assert.match(err, /NOT published onchain/i)
})

test('save: operator local-only pin with --json reports published:false + pending owner-publish', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    runRebackupSigning: async (_step, cb) => {
      spies.rebackupCalls++
      cb.onWalletReady({ url: 'http://localhost:9999/' } as never)
      await cb.onIdentityComplete(LOCAL_ONLY_PIN, OPERATOR_PENDING_MESSAGE, 'update')
    },
  })
  const { result, out } = await withCapturedOutput(() => runSave(['--json'], deps))
  assert.equal(result, 4)
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.published, false)
  assert.equal(parsed.pending, 'owner-publish')
  assert.equal(parsed.cid, 'snap-cid-local')
})

test('save: published path verifies the onchain pointer and returns 0', async () => {
  const spies = freshSpies()
  const { result, out } = await withCapturedOutput(() => runSave([], makeDeps(spies)))
  assert.equal(result, 0)
  assert.match(out, /published onchain/i)
  assert.match(out, /verified/i)
})

test('save: published but onchain pointer still stale returns 0 with a warning', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    discoverOwnedAgentBackupByTokenId: async () => ({ backup: { cid: 'a-different-cid' } }) as never,
  })
  const { result, err } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 0)
  assert.match(err, /does not yet resolve/i)
})

test('save: an operator-through-vault publish (metadataCid set, no txHash) reports published and returns 0', async () => {
  const spies = freshSpies()
  const deps = makeDeps(spies, {
    runRebackupSigning: async (_step, cb) => {
      spies.rebackupCalls++
      cb.onWalletReady({ url: 'http://localhost:9999/' } as never)
      await cb.onIdentityComplete(VAULT_PUBLISHED, 'Snapshot published onchain through the Vault.', 'update')
    },
    discoverOwnedAgentBackupByTokenId: async () => ({ backup: { cid: 'snap-cid-2' } }) as never,
  })
  const { result, out } = await withCapturedOutput(() => runSave([], deps))
  assert.equal(result, 0)
  assert.match(out, /published onchain/i)
  assert.equal(spies.saved[0]?.identity?.backup?.cid, 'snap-cid-2')
})
