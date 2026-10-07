import fs from 'node:fs'
import path from 'node:path'
import {
  createWalletClient,
  getAddress,
  http,
  namehash,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'
import type { BrowserWalletReady, BrowserWalletSession } from '../../src/identity/wallet/browserWallet.js'
import { defaultHistoryDeps, type HistoryDeps } from '../../src/cli/history/shared.js'
import { captureIo, type CapturedIo } from '../support/home.js'

// Shared setup for the chain suite (run by test/run-chain.mjs). Every request that is
// not to this machine is refused, so a test can never reach a public RPC or gateway.

const MAINNET_RPC = requiredEnv('ETHAGENT_CHAIN_MAINNET_RPC')
const BASE_RPC = requiredEnv('ETHAGENT_CHAIN_BASE_RPC')
const ARTIFACTS = requiredEnv('ETHAGENT_CHAIN_ARTIFACTS')

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; run the chain suite with \`npm run test:chain\``)
  return value
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new TypeError(`fetch failed: the chain suite refuses ${url.host}`)
  }
  return realFetch(input, init)
}) as typeof fetch

// Anvil's well-known development keys: funded on both chains, never real.
export const KEYS = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  operator: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  receiver: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  parent: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
} as const satisfies Record<string, Hex>

export type Role = keyof typeof KEYS
export const ADDRESS: Record<Role, Address> = Object.fromEntries(
  Object.entries(KEYS).map(([role, key]) => [role, privateKeyToAccount(key).address]),
) as Record<Role, Address>

export const REGISTRY = getAddress('0x8004A169FB4a3325136EB29fA0ceB6D2e539a432')
const ENS_REGISTRY = getAddress('0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e')
const PUBLIC_RESOLVER = getAddress('0xF29100983E058B709F3D539b0c765937B804AC15')
const UNIVERSAL_RESOLVER = getAddress('0xeeeeeeee14d718c2b47d9923deab1335e144eeee')

export async function rpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const response = await realFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.json() as { result?: T; error?: { message: string } }
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return body.result as T
}

function runtimeCode(file: string, contract: string): Hex {
  const artifact = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, file, `${contract}.json`), 'utf8')) as { deployedBytecode: { object: Hex } }
  return artifact.deployedBytecode.object
}

// Puts the stand-in contracts at the real addresses on a fresh pair of chains.
export async function placeContracts(): Promise<void> {
  await rpc(BASE_RPC, 'anvil_setCode', [REGISTRY, runtimeCode('ChainIdentityRegistry.sol', 'ChainIdentityRegistry')])
  await rpc(MAINNET_RPC, 'anvil_setCode', [ENS_REGISTRY, runtimeCode('ChainEns.sol', 'ChainEnsRegistry')])
  await rpc(MAINNET_RPC, 'anvil_setCode', [PUBLIC_RESOLVER, runtimeCode('ChainEns.sol', 'ChainPublicResolver')])
  await rpc(MAINNET_RPC, 'anvil_setCode', [UNIVERSAL_RESOLVER, runtimeCode('ChainEns.sol', 'ChainUniversalResolver')])
}

// Hands a top-level name to an address, as buying it would.
export async function giveName(name: string, to: Address): Promise<void> {
  const wallet = createWalletClient({ account: privateKeyToAccount(KEYS.parent), chain: mainnet, transport: http(MAINNET_RPC) })
  await wallet.writeContract({
    address: ENS_REGISTRY,
    abi: [{ type: 'function', name: 'testSetOwner', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'owner', type: 'address' }], outputs: [] }],
    functionName: 'testSetOwner',
    args: [namehash(name), to],
  })
}

const CHAINS = { 1: { chain: mainnet, rpc: MAINNET_RPC }, 8453: { chain: base, rpc: BASE_RPC } } as const

// A wallet session that signs with the development keys instead of a browser tab. A
// request naming its account gets that one; anything else gets the account in use,
// which a test switches like a person switching accounts in their wallet.
export class TestWallet {
  current: Role = 'owner'
  readonly prompts: string[] = []
  opened = 0

  use(role: Role): this {
    this.current = role
    return this
  }

  private roleFor(expected?: Address): Role {
    if (!expected) return this.current
    const role = (Object.keys(ADDRESS) as Role[]).find(item => ADDRESS[item].toLowerCase() === expected.toLowerCase())
    if (!role) throw new Error(`the test wallet holds no key for ${expected}`)
    return role
  }

  private walletFor(chainId: number, role: Role) {
    const target = CHAINS[chainId as keyof typeof CHAINS]
    if (!target) throw new Error(`the test wallet has no chain ${chainId}`)
    return createWalletClient({ account: privateKeyToAccount(KEYS[role]), chain: target.chain, transport: http(target.rpc) })
  }

  readonly session: BrowserWalletSession = {
    url: 'http://127.0.0.1/test-wallet',
    requestSignature: async req => {
      const role = this.roleFor(req.expectedAccount)
      const account = ADDRESS[role]
      const message = req.message ?? req.messageForAccount?.(account)
      if (message === undefined) throw new Error('signature request without a message')
      this.prompts.push(`sign:${req.purpose ?? 'unknown'}:${role}`)
      return { account, message, signature: await privateKeyToAccount(KEYS[role]).signMessage({ message }) }
    },
    sendTransaction: async req => {
      const role = this.roleFor(req.expectedAccount)
      this.prompts.push(`send:${req.purpose ?? 'unknown'}:${role}`)
      const txHash = await this.walletFor(req.chainId, role).sendTransaction({
        to: req.to ?? null,
        data: req.data,
        ...(req.value ? { value: BigInt(req.value) } : {}),
      } as never)
      return { account: ADDRESS[role], txHash }
    },
    requestSignatureAndTransaction: async req => {
      const signed = await this.session.requestSignature(req)
      const prepared = await req.prepareTransaction(signed)
      const role = this.roleFor(signed.account)
      this.prompts.push(`send:${req.purpose ?? 'unknown'}:${role}`)
      const txHash = await this.walletFor(req.chainId, role).sendTransaction({
        to: prepared.to,
        data: prepared.data,
        ...(prepared.value ? { value: BigInt(prepared.value) } : {}),
      } as never)
      return { ...signed, txHash, prepared: prepared.prepared }
    },
    close: async () => {},
  }

  open = async (onReady: (ready: BrowserWalletReady) => void): Promise<BrowserWalletSession> => {
    this.opened += 1
    onReady({ url: this.session.url })
    return this.session
  }
}

// History deps over the real config in this process's HOME, with captured output and
// an optional injected operator key.
export function chainDeps(operatorKey?: Role): HistoryDeps & { io: CapturedIo } {
  const deps: HistoryDeps & { io: CapturedIo } = { ...defaultHistoryDeps(), io: captureIo(), env: process.env }
  if (operatorKey) deps.operatorKey = { ok: true, key: KEYS[operatorKey], address: ADDRESS[operatorKey] }
  return deps
}

export const RPC = { mainnet: MAINNET_RPC, base: BASE_RPC }
