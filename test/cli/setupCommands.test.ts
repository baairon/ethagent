import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress } from 'viem'
import { runCreateCommand, type CreateSeams } from '../../src/cli/onchain/create.js'
import { runStorageCommand, type StorageSeams } from '../../src/cli/onchain/storage.js'
import { runTransferCommand, type TransferSeams } from '../../src/cli/onchain/transfer.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import { TokenInVaultError } from '../../src/identity/manager/custody/preflight.js'
import { captureIo, type CapturedIo } from '../support/home.js'

const OWNER = getAddress('0xA1E9000000000000000000000000000000000001')
const RECEIVER = getAddress('0x000000000000000000000000000000000000bEEF')
const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')

function identity(): EthagentIdentity {
  return {
    source: 'erc8004', address: OWNER, ownerAddress: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY, agentId: '45744', agentUri: 'ipfs://x', state: {},
  } as EthagentIdentity
}

function deps(config: EthagentConfig | null, env: NodeJS.ProcessEnv = {}): HistoryDeps & { io: CapturedIo } {
  return { io: captureIo(), env, now: () => new Date(), loadConfig: async () => config, listLedger: async () => [] }
}

// --- create -----------------------------------------------------------------------

function createSeams(record: { minted?: boolean; saved?: EthagentConfig; custody?: string[] } = {}): CreateSeams {
  return {
    sign: async (step, callbacks, opts) => {
      assert.ok(opts?.session, 'the mint goes through the command\'s wallet tab')
      record.minted = true
      await callbacks.onIdentityComplete({
        ...identity(),
        agentId: '50000',
        state: { name: step.name, custodyMode: step.custodyMode },
        backup: { cid: 'bafy', txHash: '0xmint' } as never,
      }, 'created', 'create')
    },
    scanImports: async () => [{ source: 'Claude Code', raw: 'notes', contentLines: 12 }],
    resolveJwt: async () => 'jwt',
    openSession: async () => ({ close: async () => {} }) as never,
    openExternal: () => {},
    saveConfig: async config => { record.saved = config },
    custody: {
      client: () => ({ readContract: async () => OWNER, getBytecode: async () => '0x', simulateContract: async () => ({}), getBlockNumber: async () => 1n }) as never,
      priorVault: async () => ({ found: false }),
      reusableVault: async () => undefined,
      deploy: async () => { record.custody?.push('deploy'); return { txHash: '0xd', vaultAddress: '0x6bdC0000000000000000000000000000000051d7' } },
      deposit: async () => { record.custody?.push('deposit'); return { txHash: '0xe', receiptBlock: 1n, build: {} as never } },
      confirmDeposit: async () => ({ inVault: true, ownerAddress: OWNER }),
      unwrap: async () => null,
      revoke: async () => [],
      recordVault: async () => {},
      publish: async (step, callbacks) => { record.custody?.push('save'); await callbacks.onIdentityComplete(step.identity, 'saved') },
      resolveJwt: async () => 'jwt',
      vaultStatus: async () => ({ ready: true }) as never,
      pullHarness: async () => [],
      openSession: async () => { throw new Error('create must share its own tab') },
      openExternal: () => {},
      saveConfig: async () => {},
    },
  }
}

test('create previews the mint and needs a network and a name', async () => {
  const noNetwork = deps(null)
  assert.equal(await runCreateCommand(['--name', 'meow', '--json'], noNetwork, createSeams()), 2)
  const shortName = deps(null)
  assert.equal(await runCreateCommand(['--name', 'm', '--network', 'base', '--json'], shortName, createSeams()), 2)
  const preview = deps(null)
  const record: { minted?: boolean } = {}
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--import', '--json'], preview, createSeams(record)), 0)
  const out = preview.io.json() as Record<string, any>
  assert.equal(out.applied, false)
  assert.equal(out.chainId, 8453)
  assert.deepEqual(out.imports, [{ source: 'Claude Code', lines: 12 }])
  assert.equal(record.minted, undefined)
})

test('create refuses when this machine has an agent unless --replace', async () => {
  const config = { version: 2, firstSeenAt: '', identity: identity() } as EthagentConfig
  const refused = deps(config)
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--json'], refused, createSeams()), 1)
  assert.match(String(refused.io.json().hint), /--replace/)
  const allowed = deps(config)
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--replace', '--json'], allowed, createSeams()), 0)
})

test('create --yes mints and saves; --advanced continues into custody in the same tab', async () => {
  const record: { minted?: boolean; saved?: EthagentConfig; custody: string[] } = { custody: [] }
  const simple = deps(null)
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--yes', '--json'], simple, createSeams(record)), 0)
  assert.equal(record.saved?.identity?.agentId, '50000')
  assert.deepEqual(record.custody, [])
  const advanced = deps(null)
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--advanced', '--yes', '--json'], advanced, createSeams(record)), 0, advanced.io.stdout())
  assert.deepEqual(record.custody, ['deploy', 'deposit', 'save'])
  assert.ok((advanced.io.json() as Record<string, unknown>).custodyResult)
})

test('create --yes exits 3 without a storage credential, before any wallet prompt', async () => {
  const record: { minted?: boolean } = {}
  const d = deps(null)
  assert.equal(await runCreateCommand(['--name', 'meow', '--network', 'base', '--yes', '--json'], d, { ...createSeams(record), resolveJwt: async () => undefined }), 3)
  assert.equal(record.minted, undefined)
})

// --- storage ----------------------------------------------------------------------

function storageSeams(state: { saved: boolean; stdin?: string; received?: string }): StorageSeams {
  return {
    has: async () => state.saved,
    save: async input => { state.received = input; state.saved = true; return { backend: 'file' } },
    clear: async () => { state.saved = false },
    readStdin: async () => state.stdin ?? '',
    apiUrl: 'https://uploads.pinata.cloud/v3/files',
  }
}

test('storage reports readiness, reads the JWT only from stdin, and previews a forget', async () => {
  const state = { saved: false, stdin: 'eyJ.jwt.value\n' } as { saved: boolean; stdin?: string; received?: string }
  const view = deps(null, { PINATA_JWT: '' })
  assert.equal(await runStorageCommand(['--json'], view, storageSeams(state)), 0)
  assert.equal(view.io.json().ready, false)
  const arg = deps(null)
  assert.equal(await runStorageCommand(['--set', 'eyJ.jwt.value', '--json'], arg, storageSeams(state)), 2)
  const set = deps(null)
  assert.equal(await runStorageCommand(['--set', '--json'], set, storageSeams(state)), 0)
  assert.equal(state.received, 'eyJ.jwt.value')
  const preview = deps(null)
  assert.equal(await runStorageCommand(['--forget', '--json'], preview, storageSeams(state)), 0)
  assert.equal(state.saved, true)
  const forget = deps(null)
  assert.equal(await runStorageCommand(['--forget', '--yes', '--json'], forget, storageSeams(state)), 0)
  assert.equal(state.saved, false)
})

// --- transfer ---------------------------------------------------------------------

function transferSeams(record: { signed?: boolean; saved?: EthagentConfig } = {}): TransferSeams {
  return {
    resolveTarget: async handle => {
      if (handle.endsWith('.eth')) return RECEIVER
      return getAddress(handle)
    },
    assertNotInVault: async () => {},
    sign: async step => {
      record.signed = true
      return { identity: { ...step.identity, backup: { cid: 'bafytransfer' } as never }, snapshotCid: 'bafytransfer', txHash: '0xpublish' }
    },
    resolveJwt: async () => 'jwt',
    vaultStatus: async () => ({ ready: true }) as never,
    pullHarness: async () => [],
    openExternal: () => {},
    saveConfig: async config => { record.saved = config },
  }
}

test('transfer previews both signatures and says ethagent never moves the token', async () => {
  const config = { version: 2, firstSeenAt: '', identity: identity() } as EthagentConfig
  const d = deps(config)
  const record: { signed?: boolean } = {}
  assert.equal(await runTransferCommand(['receiver.eth', '--json'], d, transferSeams(record)), 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.receiver, RECEIVER)
  assert.equal(out.receiverName, 'receiver.eth')
  assert.deepEqual(out.steps.map((step: any) => step.step), ['sender-sign', 'receiver-sign', 'publish'])
  assert.match(out.afterwards, /ethagent does not move it/)
  assert.equal(record.signed, undefined)
})

test('transfer --yes publishes the snapshot and saves the identity', async () => {
  const config = { version: 2, firstSeenAt: '', identity: identity() } as EthagentConfig
  const record: { signed?: boolean; saved?: EthagentConfig } = {}
  const d = deps(config)
  assert.equal(await runTransferCommand([RECEIVER, '--yes', '--json'], d, transferSeams(record)), 0)
  assert.equal(record.signed, true)
  assert.equal(record.saved?.identity?.backup?.cid, 'bafytransfer')
})

test('transfer refuses the owner itself and a token held in a Vault', async () => {
  const config = { version: 2, firstSeenAt: '', identity: identity() } as EthagentConfig
  const self = deps(config)
  assert.equal(await runTransferCommand([OWNER, '--json'], self, transferSeams()), 1)
  const inVault = deps(config)
  assert.equal(await runTransferCommand([RECEIVER, '--json'], inVault, {
    ...transferSeams(),
    assertNotInVault: async () => { throw new TokenInVaultError('0x6bdC0000000000000000000000000000000051d7') },
  }), 1)
  assert.match(String(inVault.io.json().hint), /custody --simple/)
  const none = deps(config)
  assert.equal(await runTransferCommand(['--json'], none, transferSeams()), 2)
})
