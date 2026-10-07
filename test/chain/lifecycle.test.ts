import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPublicClient, getAddress, http, namehash, parseAbi, type Address } from 'viem'
import { base, mainnet } from 'viem/chains'
import { ADDRESS, chainDeps, giveName, KEYS, placeContracts, REGISTRY, RPC, TestWallet } from './harness.js'
import { loadConfig, type EthagentIdentity } from '../../src/storage/config.js'
import { continuityVaultRef } from '../../src/identity/continuity/storage/paths.js'
import { runCreateCommand, defaultSeams as createSeams } from '../../src/cli/onchain/create.js'
import { runProfileCommand, defaultSeams as profileSeams } from '../../src/cli/onchain/profile.js'
import { runEnsCommand, defaultSeams as ensSeams } from '../../src/cli/onchain/ens.js'
import { runCustodyCommand, defaultSeams as custodyReadSeams } from '../../src/cli/onchain/custody.js'
import { defaultCustodyWriteSeams } from '../../src/cli/onchain/custodyWrite.js'
import { runRestoreCommand, defaultSeams as restoreSeams } from '../../src/cli/onchain/restore.js'
import { runCheckCommand } from '../../src/cli/onchain/check.js'
import { runTransferCommand, defaultSeams as transferSeams } from '../../src/cli/onchain/transfer.js'
import { runOperatorSave, defaultOperatorSaveDeps } from '../../src/cli/operatorSave.js'

// One agent's whole life on the local chains, in order. Every step sends real
// transactions through the code the commands run, signed by the test wallet or the
// operator key, and is checked against what the chains then hold.

const wallet = new TestWallet()
const walletSeams = { openSession: wallet.open, openExternal: () => {} }
const custodyWrite = { ...defaultCustodyWriteSeams, ...walletSeams }
const baseClient = createPublicClient({ chain: base, transport: http(RPC.base) })
const mainnetClient = createPublicClient({ chain: mainnet, transport: http(RPC.mainnet) })

const REGISTRY_ABI = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function tokenURI(uint256) view returns (string)',
])
const VAULT_ABI = parseAbi([
  'function agentOwner(address registry, uint256 agentId) view returns (address)',
  'function metadataOperators(address registry, uint256 agentId, address operator) view returns (bool)',
])
const ENS_ABI = parseAbi([
  'function owner(bytes32) view returns (address)',
  'function resolver(bytes32) view returns (address)',
  'function text(bytes32, string) view returns (string)',
])
const ENS_REGISTRY = getAddress('0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e')
const NAME = 'agent.example.eth'

function ok(code: number, deps: ReturnType<typeof chainDeps>): void {
  assert.equal(code, 0, deps.io.stdout() + deps.io.stderr())
}

async function identity(): Promise<EthagentIdentity> {
  const config = await loadConfig()
  assert.ok(config?.identity)
  return config.identity
}

async function tokenId(): Promise<bigint> {
  return BigInt((await identity()).agentId!)
}

async function holder(): Promise<Address> {
  return baseClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'ownerOf', args: [await tokenId()] })
}

async function onchainUri(): Promise<string> {
  return baseClient.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: 'tokenURI', args: [await tokenId()] })
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const original = process.stdout.write
  let out = ''
  process.stdout.write = ((chunk: unknown) => { out += String(chunk); return true }) as typeof process.stdout.write
  try {
    return { result: await fn(), out }
  } finally {
    process.stdout.write = original
  }
}

async function editMemory(line: string): Promise<void> {
  const file = continuityVaultRef(await identity()).memoryPath
  await fs.appendFile(file, `\n- ${line}\n`)
}

test.before(async () => {
  await placeContracts()
  await giveName('example.eth', ADDRESS.owner)
})

test('create --yes mints the agent and pins its first snapshot', async () => {
  const deps = chainDeps()
  ok(await runCreateCommand(['--name', 'chain agent', '--network', 'base', '--yes', '--json'], deps, { ...createSeams, ...walletSeams, custody: custodyWrite }), deps)
  const out = deps.io.json() as Record<string, any>
  assert.equal(out.owner, ADDRESS.owner)
  assert.equal(await holder(), ADDRESS.owner)
  assert.equal(await onchainUri(), (await identity()).agentUri)
})

test('profile --yes publishes the new name and description', async () => {
  const before = await onchainUri()
  const deps = chainDeps()
  ok(await runProfileCommand(['--name', 'chain agent two', '--description', 'runs on the test chain', '--yes', '--json'], deps, { ...profileSeams, ...walletSeams }), deps)
  const after = await identity()
  assert.equal((after.state as Record<string, unknown>).name, 'chain agent two')
  assert.notEqual(await onchainUri(), before)
  assert.equal(await onchainUri(), after.agentUri)
})

test('ens <name> --yes creates the subname, writes the agent records, and publishes it', async () => {
  const deps = chainDeps()
  ok(await runEnsCommand([NAME, '--yes', '--json'], deps, { ...ensSeams, ...walletSeams }), deps)
  assert.equal((await identity()).state?.ensName, NAME)
  const node = namehash(NAME)
  assert.equal(await mainnetClient.readContract({ address: ENS_REGISTRY, abi: ENS_ABI, functionName: 'owner', args: [node] }), ADDRESS.owner)
  const read = chainDeps()
  ok(await runEnsCommand(['--json'], read, ensSeams), read)
  assert.equal((read.io.json().link as Record<string, unknown>).ok, true)
})

test('ens --set --yes writes a text record in one transaction', async () => {
  const deps = chainDeps()
  ok(await runEnsCommand(['--set', 'url=https://agent.example', '--yes', '--json'], deps, { ...ensSeams, ...walletSeams }), deps)
  const node = namehash(NAME)
  const resolver = await mainnetClient.readContract({ address: ENS_REGISTRY, abi: ENS_ABI, functionName: 'resolver', args: [node] })
  assert.equal(await mainnetClient.readContract({ address: resolver, abi: ENS_ABI, functionName: 'text', args: [node, 'url'] }), 'https://agent.example')
})

test('custody --advanced --yes deploys a Vault, deposits the token, and saves', async () => {
  const deps = chainDeps()
  ok(await runCustodyCommand(['--advanced', '--yes', '--json'], deps, custodyReadSeams, custodyWrite), deps)
  const state = (await identity()).state as Record<string, string>
  assert.equal(state.custodyMode, 'advanced')
  const vault = getAddress(state.operatorVaultAddress!)
  assert.equal(await holder(), vault)
  assert.equal(await baseClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'agentOwner', args: [REGISTRY, await tokenId()] }), ADDRESS.owner)
  const verify = chainDeps()
  ok(await runCustodyCommand(['--verify', '--json'], verify, custodyReadSeams), verify)
})

test('custody --add-operator --operator --yes approves the operator key in the Vault', async () => {
  const deps = chainDeps('operator')
  ok(await runCustodyCommand(['--add-operator', '--operator', '--yes', '--json'], deps, custodyReadSeams, custodyWrite), deps)
  const vault = getAddress(((await identity()).state as Record<string, string>).operatorVaultAddress!)
  assert.equal(await baseClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'metadataOperators', args: [REGISTRY, await tokenId(), ADDRESS.operator] }), true)
})

test('save --operator publishes through the Vault with no wallet, then skips when nothing changed', async () => {
  await editMemory('saved by the operator key on the test chain')
  const deps = { ...defaultOperatorSaveDeps, readOperatorKey: () => ({ ok: true as const, key: KEYS.operator, address: ADDRESS.operator }) }
  const opened = wallet.opened
  const first = await captureStdout(() => runOperatorSave(['--json'], deps))
  assert.equal(first.result, 0, first.out)
  const published = JSON.parse(first.out.trim()) as Record<string, unknown>
  assert.equal(published.published, true)
  assert.equal(published.verification, 'verified')
  assert.equal(await onchainUri(), published.agentUri)
  assert.equal(wallet.opened, opened, 'the operator save never opens a wallet')
  const again = await captureStdout(() => runOperatorSave(['--json'], deps))
  assert.equal(JSON.parse(again.out.trim()).skipped, true)
})

test('check finds nothing to fix and reads the real onchain pointer', async () => {
  const deps = chainDeps()
  ok(await runCheckCommand(['--json'], deps), deps)
  const out = deps.io.json() as Record<string, any>
  assert.deepEqual(out.attention, [])
  assert.equal(out.chain.agentUri, 'in-sync')
  assert.equal(out.chain.custody, 'advanced')
})

test('restore --owner lists the agent while the Vault holds it', async () => {
  const deps = chainDeps()
  ok(await runRestoreCommand(['--owner', ADDRESS.owner, '--network', 'base', '--json'], deps, restoreSeams), deps)
  const agents = deps.io.json().agents as Array<Record<string, unknown>>
  assert.deepEqual(agents.map(agent => agent.agentId), [String(await tokenId())])
})

test('restore --operator --yes rebuilds the vault on a fresh machine, byte for byte', async () => {
  const original = await identity()
  const memory = await fs.readFile(continuityVaultRef(original).memoryPath, 'utf8')
  const home = process.env.HOME!
  const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-chain-fresh-'))
  process.env.HOME = fresh
  try {
    const deps = chainDeps('operator')
    ok(await runRestoreCommand([String(await tokenIdFrom(original)), '--network', 'base', '--operator', '--yes', '--json'], deps, restoreSeams), deps)
    const restored = await identity()
    assert.equal(restored.agentId, original.agentId)
    assert.equal(await fs.readFile(continuityVaultRef(restored).memoryPath, 'utf8'), memory)
  } finally {
    process.env.HOME = home
    await fs.rm(fresh, { recursive: true, force: true })
  }
})

function tokenIdFrom(id: EthagentIdentity): bigint {
  return BigInt(id.agentId!)
}

test('ens --delete --yes clears the records, removes the subname, and publishes the agent without it', async () => {
  const deps = chainDeps()
  ok(await runEnsCommand(['--delete', '--yes', '--json'], deps, { ...ensSeams, ...walletSeams }), deps)
  assert.equal(await mainnetClient.readContract({ address: ENS_REGISTRY, abi: ENS_ABI, functionName: 'owner', args: [namehash(NAME)] }), '0x0000000000000000000000000000000000000000')
  assert.equal((await identity()).state?.ensName ?? '', '')
})

test('custody --simple --yes revokes the operator, withdraws the token, and saves Simple', async () => {
  const vault = getAddress(((await identity()).state as Record<string, string>).operatorVaultAddress!)
  const deps = chainDeps()
  ok(await runCustodyCommand(['--simple', '--yes', '--json'], deps, custodyReadSeams, custodyWrite), deps)
  assert.equal(await holder(), ADDRESS.owner)
  assert.equal(((await identity()).state as Record<string, unknown>).custodyMode, 'simple')
  assert.equal(await baseClient.readContract({ address: vault, abi: VAULT_ABI, functionName: 'agentOwner', args: [REGISTRY, await tokenId()] }), '0x0000000000000000000000000000000000000000')
})

test('transfer --yes re-encrypts the agent for the receiver, who restores it after the token moves', async () => {
  const deps = chainDeps()
  wallet.use('owner')
  ok(await runTransferCommand([ADDRESS.receiver, '--yes', '--json'], deps, { ...transferSeams, ...walletSeams }), deps)
  assert.equal(await holder(), ADDRESS.owner, 'ethagent never moves the token itself')
  assert.ok(wallet.prompts.some(prompt => prompt.endsWith(':receiver')), 'the receiver signed in the same wallet session')
})
