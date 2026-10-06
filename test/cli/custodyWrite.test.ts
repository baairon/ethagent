import test from 'node:test'
import assert from 'node:assert/strict'
import { getAddress, type Address } from 'viem'
import { runCustodyCommand } from '../../src/cli/onchain/custody.js'
import type { CustodyWriteSeams } from '../../src/cli/onchain/custodyWrite.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import type { ProfileUpdates } from '../../src/identity/manager/reducer.js'
import { captureIo, type CapturedIo } from '../support/home.js'

const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const OWNER = getAddress('0xA1E9000000000000000000000000000000000001')
const VAULT = getAddress('0x6bdC0000000000000000000000000000000051d7')
const OPERATOR = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const ZERO = '0x0000000000000000000000000000000000000000'

function identity(state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    source: 'erc8004', address: OWNER, ownerAddress: OWNER, createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY,
    agentId: '45744', agentUri: 'ipfs://x', state: { custodyMode: 'simple', ...state },
  } as EthagentIdentity
}

function deps(id: EthagentIdentity, operatorKey?: HistoryDeps['operatorKey']): HistoryDeps & { io: CapturedIo } {
  return {
    io: captureIo(),
    env: {},
    now: () => new Date(),
    loadConfig: async () => ({ version: 2, firstSeenAt: id.createdAt, identity: id } as EthagentConfig),
    listLedger: async () => [],
    ...(operatorKey ? { operatorKey } : {}),
  }
}

type Chain = { tokenOwner: Address; vaultOwner: Address | null; approved: Address[] }
type Calls = { order: string[]; updates?: ProfileUpdates; sessions: Set<unknown>; publishVault?: string }

function writeSeams(chain: Chain, calls: Calls, overrides: Partial<CustodyWriteSeams> = {}): CustodyWriteSeams {
  const session = { close: async () => {}, requestSignature: async () => { throw new Error('no browser proof expected') } }
  const track = (name: string, s?: unknown) => { calls.order.push(name); if (s) calls.sessions.add(s) }
  return {
    client: () => ({
      readContract: async (call: { functionName: string; args?: readonly unknown[] }) => {
        if (call.functionName === 'ownerOf') return chain.tokenOwner
        if (call.functionName === 'agentOwner') return chain.vaultOwner ?? ZERO
        if (call.functionName === 'metadataOperators') return chain.approved.some(a => a.toLowerCase() === String(call.args?.[2]).toLowerCase())
        throw new Error(`unexpected read ${call.functionName}`)
      },
      getBytecode: async () => '0x00',
      simulateContract: async () => ({}),
      getBlockNumber: async () => 1n,
    }) as never,
    priorVault: async () => ({ found: false }),
    reusableVault: async () => undefined,
    deploy: async args => { track('deploy', args.session); return { txHash: '0xd1', vaultAddress: VAULT } },
    deposit: async args => { track('deposit', args.session); chain.vaultOwner = OWNER; return { txHash: '0xd2', receiptBlock: 1n, build: {} as never } },
    confirmDeposit: async () => ({ inVault: true, ownerAddress: OWNER }),
    unwrap: async args => { track('withdraw', args.session); chain.vaultOwner = null; return { txHash: '0xd3' } },
    revoke: async args => { track('revoke', args.session); return [...args.candidates] },
    recordVault: async () => {},
    publish: async (step, callbacks, s) => {
      track('save', s)
      calls.updates = step.profileUpdates
      calls.publishVault = step.vaultAddress
      await callbacks.onIdentityComplete({ ...step.identity, backup: { cid: 'bafy', txHash: '0xs' } as never }, 'saved')
    },
    resolveJwt: async () => 'jwt',
    vaultStatus: async () => ({ ready: true }) as never,
    pullHarness: async () => [],
    openSession: async () => session as never,
    openExternal: () => {},
    saveConfig: async () => {},
    ...overrides,
  }
}

const readSeams = { client: () => { throw new Error('read path not expected') } } as never

test('custody --advanced previews deploy, deposit, and save when no Vault exists yet', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const d = deps(identity())
  assert.equal(await runCustodyCommand(['--advanced', '--json'], d, readSeams, writeSeams({ tokenOwner: OWNER, vaultOwner: null, approved: [] }, calls)), 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.applied, false)
  assert.deepEqual(out.steps.map((step: any) => step.step), ['deploy', 'deposit', 'save'])
  assert.deepEqual(calls.order, [])
})

test('custody --advanced --yes runs every step in one wallet tab and saves with the new Vault', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const d = deps(identity())
  assert.equal(await runCustodyCommand(['--advanced', '--yes', '--json'], d, readSeams, writeSeams({ tokenOwner: OWNER, vaultOwner: null, approved: [] }, calls)), 0)
  assert.deepEqual(calls.order, ['deploy', 'deposit', 'save'])
  assert.equal(calls.sessions.size, 1)
  assert.deepEqual(calls.updates, { custodyMode: 'advanced', ownerAddress: OWNER, bumpRestoreAccessEpoch: true, custodyPhase: 'switch-advanced', operatorVaultAddress: VAULT })
  assert.equal(calls.publishVault, VAULT)
})

test('custody --advanced resumes: a Vault that already holds the token skips straight to the save', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const id = identity({ operatorVaultAddress: VAULT })
  const d = deps(id)
  assert.equal(await runCustodyCommand(['--advanced', '--yes', '--json'], d, readSeams, writeSeams({ tokenOwner: VAULT, vaultOwner: OWNER, approved: [] }, calls)), 0)
  assert.deepEqual(calls.order, ['save'])
})

test('custody --advanced reports what landed and exits 3 when the wallet is cancelled part way', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const d = deps(identity())
  const seams = writeSeams({ tokenOwner: OWNER, vaultOwner: null, approved: [] }, calls, {
    deposit: async () => { throw new Error('wallet request was cancelled') },
  })
  assert.equal(await runCustodyCommand(['--advanced', '--yes', '--json'], d, readSeams, seams), 3)
  assert.match(String(d.io.json().error), /Already confirmed: Vault 0x6bdc.* deployed/i)
  assert.match(String(d.io.json().error), /Run the same command again/)
})

test('custody --simple revokes approved operators, withdraws, then saves Simple', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const id = identity({ custodyMode: 'advanced', ownerAddress: OWNER, operatorVaultAddress: VAULT, approvedOperatorWallets: [{ address: OPERATOR }], activeOperatorAddress: OPERATOR })
  const d = deps(id)
  const chain = { tokenOwner: VAULT, vaultOwner: OWNER, approved: [OPERATOR] }
  assert.equal(await runCustodyCommand(['--simple', '--json'], d, readSeams, writeSeams(chain, calls)), 0)
  assert.deepEqual((d.io.json().steps as any[]).map(step => step.step), ['revoke', 'withdraw', 'save'])
  const run = deps(id)
  assert.equal(await runCustodyCommand(['--simple', '--yes', '--json'], run, readSeams, writeSeams(chain, calls)), 0)
  assert.deepEqual(calls.order, ['revoke', 'withdraw', 'save'])
  assert.equal(calls.updates?.custodyMode, 'simple')
  assert.deepEqual(calls.updates?.approvedOperatorWallets, [])
  assert.equal(calls.publishVault, undefined)
})

test('custody --add-operator --operator signs the proof with the injected key and saves the new list', async () => {
  const calls: Calls = { order: [], sessions: new Set() }
  const id = identity({ custodyMode: 'advanced', ownerAddress: OWNER, operatorVaultAddress: VAULT, restoreAccessEpoch: 4 })
  const d = deps(id, { ok: true, key: OPERATOR_KEY, address: OPERATOR })
  assert.equal(await runCustodyCommand(['--add-operator', '--operator', '--yes', '--json'], d, readSeams, writeSeams({ tokenOwner: VAULT, vaultOwner: OWNER, approved: [] }, calls)), 0, d.io.stdout())
  assert.deepEqual(calls.order, ['save'])
  const records = calls.updates?.approvedOperatorWallets as Array<{ address: string; restoreAccessKey?: unknown }>
  assert.equal(records[0]!.address, OPERATOR)
  assert.ok(records[0]!.restoreAccessKey)
  assert.equal(calls.updates?.restoreAccessEpoch, 5)
  assert.equal(calls.updates?.activeOperatorAddress, OPERATOR)
})

test('custody operator flags refuse what does not apply', async () => {
  const simple = deps(identity())
  assert.equal(await runCustodyCommand(['--add-operator', '--json'], simple, readSeams, writeSeams({ tokenOwner: OWNER, vaultOwner: null, approved: [] }, { order: [], sessions: new Set() })), 1)
  assert.match(String(simple.io.json().hint), /custody --advanced/)
  const advanced = identity({ custodyMode: 'advanced', ownerAddress: OWNER })
  const unknown = deps(advanced)
  assert.equal(await runCustodyCommand(['--remove-operator', OPERATOR, '--json'], unknown, readSeams, writeSeams({ tokenOwner: VAULT, vaultOwner: OWNER, approved: [] }, { order: [], sessions: new Set() })), 1)
  assert.match(String(unknown.io.json().error), /not an approved operator/)
  const both = deps(advanced)
  assert.equal(await runCustodyCommand(['--advanced', '--simple', '--json'], both, readSeams, writeSeams({ tokenOwner: VAULT, vaultOwner: OWNER, approved: [] }, { order: [], sessions: new Set() })), 2)
  const yesAlone = deps(advanced)
  assert.equal(await runCustodyCommand(['--yes', '--json'], yesAlone, readSeams), 2)
})
