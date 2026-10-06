import type { Address, Hex } from 'viem'
import { getAddress } from 'viem'
import { loadConfig, saveConfig, type EthagentConfig, type EthagentIdentity, type SelectableNetwork } from '../../storage/config.js'
import type { BrowserWalletReady, BrowserWalletSession } from '../../identity/wallet/browserWallet.js'
import type { EffectCallbacks } from '../../identity/manager/shared/effects/types.js'
import { isWalletCancelled } from '../../identity/manager/shared/utils.js'
import { INVALID_OPERATOR_KEY_MESSAGE, OPERATOR_KEY_ENV } from '../operatorKey.js'
import { HistoryError, type HistoryDeps, type HistoryIo } from '../history/shared.js'
import { registryConfigFromConfig } from '../../identity/registry/registryConfig.js'
import { networkForChainId, type Erc8004RegistryConfig } from '../../identity/registry/erc8004.js'

export const NETWORKS: readonly SelectableNetwork[] = ['mainnet', 'base']

export function parseNetwork(value: unknown): SelectableNetwork | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && (NETWORKS as readonly string[]).includes(value)) return value as SelectableNetwork
  throw new HistoryError(2, `--network must be one of ${NETWORKS.join(', ')}`)
}

// The injected operator key, or the exit code the history and onchain commands use:
// 3 when no key was injected, 2 when it is not a valid key.
export function requireOperatorKey(deps: HistoryDeps, command: string): { key: Hex; address: Address } {
  const key = deps.operatorKey
  if (!key || (!key.ok && key.reason === 'missing')) {
    throw new HistoryError(3, 'No operator key available.', `Run this through \`keychain exec ethagent -- ethagent ${command} <args> --operator\`, which injects ${OPERATOR_KEY_ENV}.`)
  }
  if (!key.ok) throw new HistoryError(2, INVALID_OPERATOR_KEY_MESSAGE)
  return { key: key.key, address: getAddress(key.address) }
}

// A working storage credential, or exit 3 before anything is signed or sent.
export async function requireStorage(resolveJwt: () => Promise<string | undefined>): Promise<string> {
  let jwt: string | undefined
  try {
    jwt = await resolveJwt()
  } catch (err) {
    throw new HistoryError(3, `The configured Pinata JWT is invalid or unreachable (${err instanceof Error ? err.message : String(err)}). Nothing was signed or sent.`, 'Replace it with `ethagent storage --set`.')
  }
  if (!jwt) {
    throw new HistoryError(3, 'No IPFS storage credential is configured. Nothing was signed or sent.', 'Save one with `ethagent storage --set` (reads the JWT from stdin), or export PINATA_JWT.')
  }
  return jwt
}

export type OpenSession = (onReady: (ready: BrowserWalletReady) => void) => Promise<BrowserWalletSession>

// One browser tab for a whole command, opened only when the first prompt needs it.
// Every prompt the command makes goes through it, and it is closed when the command
// ends, whatever the outcome.
export class WalletTab {
  private session: BrowserWalletSession | null = null
  constructor(
    private readonly open: OpenSession,
    private readonly io: HistoryIo,
    private readonly json: boolean,
    private readonly noOpen: boolean,
    private readonly openExternal: (url: string) => void,
  ) {}

  async get(): Promise<BrowserWalletSession> {
    if (this.session) return this.session
    this.session = await this.open(ready => {
      const sink = this.json ? this.io.err : this.io.out
      void sink(`Approve in your browser wallet tab: ${ready.url}\nKeep it open; every step of this command appears there. This waits until you approve or cancel.\n`)
      if (!this.noOpen) this.openExternal(ready.url)
    })
    return this.session
  }

  async close(): Promise<void> {
    const open = this.session
    this.session = null
    if (open) await open.close().catch(() => {})
  }
}

export function quietCallbacks(overrides: Partial<EffectCallbacks> = {}): EffectCallbacks {
  return {
    onStep: () => {},
    onWalletReady: () => {},
    onIdentityComplete: async () => {},
    ...overrides,
  }
}

// Turns a cancelled wallet prompt into exit 3, naming what had already landed so a
// re-run knows where it stands.
export function walletCancelled(err: unknown, done: string[]): HistoryError | null {
  if (!isWalletCancelled(err)) return null
  return new HistoryError(3, `Wallet approval was cancelled.${done.length ? ` Already confirmed: ${done.join('; ')}. Run the same command again to finish.` : ' Nothing was sent.'}`)
}

// Saves the identity the way the manager does when a restore, refetch, or create
// completes: into the existing config, or into a fresh one seeded with its registry.
// Called only after the files have landed, so config never points at a vault that
// was not written.
export async function persistIdentity(
  identity: EthagentIdentity,
  io: { loadConfig?: () => Promise<EthagentConfig | null>; saveConfig?: (config: EthagentConfig) => Promise<void> } = {},
): Promise<EthagentConfig> {
  if (!identity.address || !identity.agentId || !identity.agentUri || !identity.ownerAddress) {
    throw new Error('Token identity is missing ERC-8004 metadata')
  }
  const current = await (io.loadConfig ?? loadConfig)().catch(() => null)
  const registry = identity.chainId && identity.rpcUrl && identity.identityRegistryAddress
    ? { chainId: identity.chainId, rpcUrl: identity.rpcUrl, identityRegistryAddress: identity.identityRegistryAddress }
    : undefined
  const base: EthagentConfig = current ?? { version: 2, firstSeenAt: new Date().toISOString() }
  const next: EthagentConfig = {
    ...base,
    identity: { ...identity, source: 'erc8004' },
    ...(!base.erc8004 && registry ? { erc8004: registry } : {}),
  }
  await (io.saveConfig ?? saveConfig)(next)
  return next
}

// The registry for a network, honouring ETHAGENT_RPC_URL the way the manager does.
export function registryForNetwork(network: SelectableNetwork): Erc8004RegistryConfig {
  const resolved = registryConfigFromConfig({ version: 2, firstSeenAt: '', selectedNetwork: network } as EthagentConfig).config
  if (!resolved) throw new HistoryError(1, `No agent registry is known for ${network}.`)
  return resolved
}

export function networkOfChain(chainId: number): string {
  return networkForChainId(chainId) ?? `chain ${chainId}`
}
