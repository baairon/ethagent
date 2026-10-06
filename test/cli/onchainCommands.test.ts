import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, getAddress, keccak256, namehash, type Address, type Hex } from 'viem'
import { runOnchainCommand } from '../../src/cli/onchain/index.js'
import { runCustodyCommand, type CustodySeams } from '../../src/cli/onchain/custody.js'
import { runEnsCommand, type EnsSeams } from '../../src/cli/onchain/ens.js'
import type { HistoryDeps } from '../../src/cli/history/shared.js'
import type { EthagentConfig, EthagentIdentity } from '../../src/storage/config.js'
import { VAULT_RUNTIME_BYTECODE } from '../../src/identity/registry/vault.js'
import { ENS_AUTOMATION_RESOLVER_ABI } from '../../src/identity/ens/ensAutomation.js'
import { ENS_AUTOMATION_REGISTRY_ABI } from '../../src/identity/ens/ensAutomation/contracts.js'
import { AGENT_TOKEN_RECORD_KEY, buildEnsip25Key } from '../../src/identity/ens/agentRecords.js'
import { captureIo, type CapturedIo } from '../support/home.js'

const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const OWNER = getAddress('0xA1E90000000000000000000000000000000089CE')
const OPERATOR_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const OPERATOR = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
const VAULT = getAddress('0x6bdC0000000000000000000000000000000051d7')
const RESOLVER = getAddress('0xF29100983E058B709F3D539b0c765937B804AC15')
const ENS_REGISTRY = getAddress('0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e')
const ZERO = '0x0000000000000000000000000000000000000000' as Address

function identity(state: Record<string, unknown> = {}): EthagentIdentity {
  return {
    source: 'erc8004',
    address: OWNER,
    ownerAddress: OWNER,
    createdAt: '2026-01-01T00:00:00.000Z',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    identityRegistryAddress: REGISTRY,
    agentId: '45744',
    state: {
      custodyMode: 'advanced',
      ownerAddress: OWNER,
      approvedOperatorWallets: [{ address: OPERATOR }],
      activeOperatorAddress: OPERATOR,
      operatorVaultAddress: VAULT,
      ...state,
    },
  } as EthagentIdentity
}

function deps(id: EthagentIdentity, env: NodeJS.ProcessEnv = {}): HistoryDeps & { io: CapturedIo } {
  const config = {
    version: 2,
    firstSeenAt: id.createdAt,
    identity: id,
    erc8004: { chainId: 8453, rpcUrl: 'https://mainnet.base.org', identityRegistryAddress: REGISTRY },
  } as EthagentConfig
  return {
    io: captureIo(),
    env: { ...env },
    now: () => new Date('2026-10-06T00:00:00.000Z'),
    loadConfig: async () => config,
    listLedger: async () => [],
  }
}

// --- custody -----------------------------------------------------------------------

function custodyClient(opts: { code?: Hex; operatorApproved?: boolean; refuse?: (fn: string, from: string) => string | null } = {}): CustodySeams {
  const refuse = opts.refuse ?? ((fn: string, from: string) => {
    if (fn === 'unwrap' && from.toLowerCase() !== OWNER.toLowerCase()) return '0x30cd7471'
    if (fn === 'setMetadataOperator' && from.toLowerCase() !== OWNER.toLowerCase()) return '0x30cd7471'
    if (fn === 'rotateAgentURI' && from.toLowerCase() !== OWNER.toLowerCase() && !(from.toLowerCase() === OPERATOR.toLowerCase() && (opts.operatorApproved ?? true))) return '0xea8e4eb5'
    return null
  })
  return {
    client: () => ({
      getBytecode: async () => opts.code ?? VAULT_RUNTIME_BYTECODE,
      readContract: async (call: { functionName: string }) => {
        if (call.functionName === 'ownerOf') return VAULT
        if (call.functionName === 'agentOwner') return OWNER
        if (call.functionName === 'heldAgent') return [REGISTRY, 45744n, OWNER]
        if (call.functionName === 'metadataOperators') return opts.operatorApproved ?? true
        if (call.functionName === 'tokenURI') return 'ipfs://current'
        throw new Error(`unexpected read ${call.functionName}`)
      },
      simulateContract: async (call: { functionName: string; account: string }) => {
        const data = refuse(call.functionName, call.account)
        if (data) throw Object.assign(new Error('execution reverted'), { code: 3, data })
        return { result: undefined, request: {} }
      },
    }) as never,
  }
}

test('custody shows the Vault build, the holder, the Vault-level owner, and the operators', async () => {
  const d = deps(identity(), { ETHAGENT_OPERATOR_KEY: OPERATOR_KEY })
  const { readOperatorKey } = await import('../../src/cli/operatorKey.js')
  d.operatorKey = readOperatorKey(d.env)
  const code = await runCustodyCommand(['--json'], d, custodyClient())
  assert.equal(code, 0)
  const out = d.io.json()
  assert.equal(out.ok, true)
  assert.equal(out.tokenHeldBy, 'vault')
  const vault = out.vault as Record<string, any>
  assert.equal(vault.build.id, 'current')
  assert.equal(vault.holdsToken, true)
  assert.equal(vault.vaultOwner, OWNER)
  assert.deepEqual(vault.heldAgent, { registry: REGISTRY, agentId: '45744', owner: OWNER })
  assert.equal(vault.operators[0].address, OPERATOR)
  assert.equal(vault.operators[0].approved, true)
  assert.equal(vault.operators[0].operatorKey, true)
})

test('custody --verify reports each simulation and exits 0 when the Vault behaves', async () => {
  const d = deps(identity())
  const code = await runCustodyCommand(['--verify', '--json'], d, custodyClient())
  assert.equal(code, 0)
  const sims = d.io.json().simulations as Array<{ check: string; outcome: string; reason?: string; matches: boolean }>
  const byCheck = Object.fromEntries(sims.map(item => [item.check, item]))
  assert.equal(byCheck['owner withdraws the token']!.outcome, 'would succeed')
  assert.equal(byCheck['owner changes an operator']!.outcome, 'would succeed')
  assert.equal(byCheck['operator rotates the agent URI']!.outcome, 'would succeed')
  assert.equal(byCheck['operator withdraws the token']!.reason, 'NotOwner')
  assert.equal(byCheck['stranger rotates the agent URI']!.reason, 'NotAuthorized')
  assert.ok(sims.every(item => item.matches))
})

test('custody --verify exits 4 when a simulation differs from what the Vault should do', async () => {
  const d = deps(identity())
  const code = await runCustodyCommand(['--verify'], d, custodyClient({ refuse: () => null }))
  assert.equal(code, 4)
  assert.match(d.io.stdout(), /FAIL stranger rotates the agent URI: would succeed/)
})

test('custody flags code that is not a known Vault build and --verify exits 4', async () => {
  const unknown = ('0x' + '60'.repeat(1955)) as Hex
  const plain = deps(identity())
  assert.equal(await runCustodyCommand(['--json'], plain, custodyClient({ code: unknown })), 0)
  const vault = plain.io.json().vault as Record<string, any>
  assert.equal(vault.bytecode, 'unknown code')
  assert.equal(vault.code.hash, keccak256(unknown))
  assert.equal(vault.code.bytes, 1955)
  const verify = deps(identity())
  assert.equal(await runCustodyCommand(['--verify', '--json'], verify, custodyClient({ code: unknown })), 4)
  assert.match((verify.io.json().issues as string[])[0]!, /not a known Vault build/)
})

test('custody and ens dispatch through the onchain command set', async () => {
  const d = deps(identity())
  assert.equal(await runOnchainCommand('custody', ['--help'], d), 0)
  assert.match(d.io.stdout(), /usage: ethagent custody/)
  const e = deps(identity())
  assert.equal(await runOnchainCommand('ens', ['--help'], e), 0)
  assert.match(e.io.stdout(), /--operator/)
})

// --- ens ---------------------------------------------------------------------------

type FakeName = { owner: Address; resolver?: Address; addr?: Address; text?: Record<string, string>; delegates?: Address[] }

function ensSeams(names: Record<string, FakeName>, calls: Array<{ account: string; to: string; data: Hex }> = []): EnsSeams {
  const byNode = new Map<string, FakeName>()
  for (const [name, value] of Object.entries(names)) byNode.set(namehash(name), value)
  const client = {
    readContract: async (call: { address: string; functionName: string; args: readonly unknown[] }) => {
      const node = call.args?.[0] as string
      if (call.address.toLowerCase() === ENS_REGISTRY.toLowerCase()) {
        const entry = byNode.get(node)
        if (call.functionName === 'owner') return entry?.owner ?? ZERO
        if (call.functionName === 'resolver') return entry?.resolver ?? ZERO
      }
      if (call.functionName === 'text') return byNode.get(call.args[0] as string)?.text?.[call.args[1] as string] ?? ''
      if (call.functionName === 'addr') return byNode.get(node)?.addr ?? ZERO
      if (call.functionName === 'isApprovedFor') {
        const entry = byNode.get(call.args[1] as string)
        return Boolean(entry?.delegates?.some(item => item.toLowerCase() === String(call.args[2]).toLowerCase()))
      }
      throw new Error(`unexpected read ${call.functionName}`)
    },
    getEnsAddress: async ({ name }: { name: string }) => byNode.get(namehash(name))?.addr ?? null,
    call: async (request: { account: string; to: string; data: Hex }) => {
      calls.push(request)
      return { data: '0x' }
    },
  }
  return {
    ensClient: () => { throw new Error('a preview must not build a sending client') },
    readClient: () => client as never,
    operatorSender: () => { throw new Error('a preview must not send') },
    openSession: async () => { throw new Error('a preview must not open the wallet') },
    publish: async () => { throw new Error('a preview must not publish') },
    resolveJwt: async () => 'jwt',
    vaultStatus: async () => ({ ready: true }) as never,
    pullHarness: async () => [],
    openExternal: () => {},
    saveConfig: async () => {},
  }
}

const ENSIP25_BASE = buildEnsip25Key({ chainId: 8453, identityRegistryAddress: REGISTRY, agentId: '45744' })
const ENSIP25_MAINNET = buildEnsip25Key({ chainId: 1, identityRegistryAddress: REGISTRY, agentId: '45744' })
const TOKEN_VALUE = `eip155:8453:${REGISTRY.toLowerCase()}:45744`

function operatorDeps(id: EthagentIdentity): HistoryDeps & { io: CapturedIo } {
  const d = deps(id)
  d.operatorKey = { ok: true, key: OPERATOR_KEY, address: OPERATOR }
  return d
}

test('ens shows the linked name, its records, the two-way verdict, and whether the operator key can sign', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const d = operatorDeps(id)
  const code = await runEnsCommand(['--json'], d, ensSeams({
    'meow.femboi.eth': { owner: OPERATOR, resolver: RESOLVER, addr: OWNER, text: { [ENSIP25_BASE]: '1', [AGENT_TOKEN_RECORD_KEY]: TOKEN_VALUE } },
  }))
  assert.equal(code, 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.name, 'meow.femboi.eth')
  assert.equal(out.records.addr, OWNER)
  assert.equal(out.records.text[ENSIP25_BASE], '1')
  assert.equal(out.link.ok, true)
  assert.equal(out.control.owner, OPERATOR)
  assert.deepEqual(out.operator, { address: OPERATOR, canSign: true, via: 'owner' })
})

test('ens <name> --operator previews creating the name, one records multicall, and clearing the old name', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const d = operatorDeps(id)
  const simulated: Array<{ account: string; to: string; data: Hex }> = []
  const code = await runEnsCommand(['purr.femboi.eth', '--operator', '--json'], d, ensSeams({
    'femboi.eth': { owner: OPERATOR, resolver: RESOLVER },
    'meow.femboi.eth': { owner: OPERATOR, resolver: RESOLVER, addr: OWNER, text: { [ENSIP25_BASE]: '1', [AGENT_TOKEN_RECORD_KEY]: TOKEN_VALUE } },
  }, simulated))
  assert.equal(code, 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.applied, false)
  assert.equal(out.create, true)
  assert.deepEqual(out.signer, { kind: 'operator', address: OPERATOR })
  assert.deepEqual(out.transactions.map((tx: any) => tx.step), ['create-subdomain', 'set-records', 'clear-old-records'])
  assert.equal(out.transactions[0].simulation, 'would succeed')
  assert.equal(out.transactions[1].simulation, 'runs after the step before it')
  assert.deepEqual(out.publish, { ensName: 'purr.femboi.eth', signer: 'owner wallet', via: 'vault' })
  // Each independent transaction was simulated from the operator, not the owner.
  assert.ok(simulated.length >= 1)
  assert.ok(simulated.every(call => call.account.toLowerCase() === OPERATOR.toLowerCase()))
  const create = decodeFunctionData({ abi: ENS_AUTOMATION_REGISTRY_ABI, data: simulated[0]!.data })
  assert.equal(create.functionName, 'setSubnodeRecord')
  assert.equal((create.args as readonly unknown[])[2], OPERATOR)
})

test('ens <name> writes addr only on a name it creates, and the old-name clear covers every agent key present', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const d = deps(id)
  const seams = ensSeams({
    'femboi.eth': { owner: OWNER, resolver: RESOLVER },
    'meow.femboi.eth': { owner: OWNER, resolver: RESOLVER, addr: OWNER, text: { [ENSIP25_BASE]: '1', [ENSIP25_MAINNET]: '1', [AGENT_TOKEN_RECORD_KEY]: TOKEN_VALUE } },
  })
  const { planEnsSwap } = await import('../../src/identity/manager/ens/headless.js')
  const plan = await planEnsSwap({
    client: seams.readClient(),
    newName: 'purr.femboi.eth',
    oldName: 'meow.femboi.eth',
    signer: OWNER,
    signerRole: 'owner wallet',
    agentOwner: OWNER,
    chainId: 8453,
    identityRegistryAddress: REGISTRY,
    agentId: '45744',
  })
  const records = plan.transactions.find(tx => tx.step === 'set-records')!
  const multicall = decodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, data: records.data })
  assert.equal(multicall.functionName, 'multicall')
  const inner = (multicall.args![0] as Hex[]).map(data => decodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, data }))
  assert.deepEqual(inner.map(call => call.functionName), ['setAddr', 'setText', 'setText'])
  assert.equal((inner[0]!.args as readonly unknown[])[1], OWNER)
  const clear = plan.transactions.find(tx => tx.step === 'clear-old-records')!
  const cleared = decodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, data: clear.data })
  const clearedKeys = (cleared.args![0] as Hex[]).map(data => (decodeFunctionData({ abi: ENS_AUTOMATION_RESOLVER_ABI, data }).args as readonly unknown[]))
  assert.deepEqual(clearedKeys.map(args => args[1]).sort(), [ENSIP25_BASE, ENSIP25_MAINNET, AGENT_TOKEN_RECORD_KEY].sort())
  assert.ok(clearedKeys.every(args => args[2] === ''))
  void d
})

test('ens <name> on an existing name never sets addr and refuses when it resolves elsewhere', async () => {
  const id = identity({ ensName: '' })
  const d = deps(id)
  const code = await runEnsCommand(['other.femboi.eth', '--json'], d, ensSeams({
    'other.femboi.eth': { owner: OWNER, resolver: RESOLVER, addr: OPERATOR },
  }))
  assert.equal(code, 1)
  assert.match(String(d.io.json().error), /resolves to .* not the agent owner/)
  assert.match(String(d.io.json().hint), /Nothing was sent/)
})

test('ens refuses before sending when the signer does not control the name', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const d = deps(id)
  const code = await runEnsCommand(['--set', 'url=https://example.com', '--json'], d, ensSeams({
    'meow.femboi.eth': { owner: OPERATOR, resolver: RESOLVER, addr: OWNER },
  }))
  assert.equal(code, 1)
  assert.match(String(d.io.json().error), /does not control meow\.femboi\.eth/)
})

test('ens --set accepts a resolver delegate and writes every change in one multicall; no change sends nothing', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const names = { 'meow.femboi.eth': { owner: OPERATOR, resolver: RESOLVER, addr: OWNER, delegates: [OWNER], text: { url: 'https://old.example', description: 'agent' } } }
  const d = deps(id)
  const code = await runEnsCommand(['--set', 'url=https://new.example', '--clear', 'description', '--set', 'avatar=ipfs://x', '--json'], d, ensSeams(names))
  assert.equal(code, 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.applied, false)
  assert.equal(out.transactions.length, 1)
  assert.equal(out.publish, null)
  assert.deepEqual(out.changes.map((change: any) => change.key).sort(), ['avatar', 'description', 'url'])
  const same = deps(id)
  assert.equal(await runEnsCommand(['--set', 'url=https://old.example', '--json'], same, ensSeams(names)), 0)
  assert.deepEqual(same.io.json().transactions, [])
})

test('ens --unlink previews clearing the records and an owner-signed save with no name', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const d = deps(id)
  const code = await runEnsCommand(['--unlink', '--json'], d, ensSeams({
    'meow.femboi.eth': { owner: OWNER, resolver: RESOLVER, addr: OWNER, text: { [ENSIP25_BASE]: '1' } },
  }))
  assert.equal(code, 0)
  const out = d.io.json() as Record<string, any>
  assert.equal(out.transactions[0].step, 'clear-records')
  assert.equal(out.publish.ensName, '')
})

test('ens --operator exits 3 without a key and 2 with an invalid one', async () => {
  const id = identity({ ensName: 'meow.femboi.eth' })
  const missing = deps(id)
  missing.operatorKey = { ok: false, reason: 'missing' }
  assert.equal(await runEnsCommand(['--unlink', '--operator', '--json'], missing, ensSeams({})), 3)
  assert.match(String(missing.io.json().hint), /keychain exec/)
  const invalid = deps(id)
  invalid.operatorKey = { ok: false, reason: 'invalid' }
  assert.equal(await runEnsCommand(['--unlink', '--operator', '--json'], invalid, ensSeams({})), 2)
})

test('ens rejects mixing a name with --unlink or --set', async () => {
  const d = deps(identity())
  assert.equal(await runEnsCommand(['a.femboi.eth', '--unlink'], d, ensSeams({})), 2)
})
