import {
  createPublicClient,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  decodeEventLog,
  formatEther,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem'
import { mainnet, arbitrum, base, optimism, polygon } from 'viem/chains'
import type { SelectableNetwork } from '../storage/config.js'
import { catFromIpfs, DEFAULT_IPFS_API_URL } from './ipfs.js'

export const DEFAULT_ERC8004_CHAIN_ID = 1
export const DEFAULT_ETHEREUM_RPC_URL = 'https://ethereum.publicnode.com'
export const DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const DISCOVERY_CONCURRENCY = 2

export type SupportedErc8004Chain = {
  chainId: number
  name: string
  rpcUrl: string
  fallbackRpcUrls: string[]
  identityRegistryAddress?: Address
  fromBlock?: bigint
  logBlockRange: bigint
  kind: 'mainnet' | 'l2'
  network: SelectableNetwork
}

export const SUPPORTED_ERC8004_CHAINS: SupportedErc8004Chain[] = [
  chainEntry(mainnet.id,  'Ethereum Mainnet', DEFAULT_ETHEREUM_RPC_URL,              [],                                DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 24_339_871n,  10_000n, 'mainnet', 'mainnet'),
  chainEntry(arbitrum.id, 'Arbitrum One',     'https://arbitrum-one.publicnode.com', [],                                DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 428_895_443n, 20_000n, 'l2',      'arbitrum'),
  chainEntry(base.id,     'Base',             'https://mainnet.base.org',            ['https://base.publicnode.com'],    DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 41_663_783n,  5_000n,  'l2',      'base'),
  chainEntry(optimism.id, 'Optimism',         'https://optimism.publicnode.com',     ['https://mainnet.optimism.io'],    DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 147_514_947n, 20_000n, 'l2',      'optimism'),
  chainEntry(polygon.id,  'Polygon',          'https://polygon-bor.publicnode.com',  ['https://polygon-rpc.com'],        DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 82_458_484n,  10_000n, 'l2',      'polygon'),
]

const NETWORK_TO_CHAIN_ID: Record<SelectableNetwork, number> = {
  mainnet:  mainnet.id,
  arbitrum: arbitrum.id,
  base:     base.id,
  optimism: optimism.id,
  polygon:  polygon.id,
}

export function chainIdForNetwork(network: SelectableNetwork): number {
  return NETWORK_TO_CHAIN_ID[network]
}

export function networkForChainId(chainId: number): SelectableNetwork | undefined {
  for (const [network, id] of Object.entries(NETWORK_TO_CHAIN_ID) as Array<[SelectableNetwork, number]>) {
    if (id === chainId) return network
  }
  return undefined
}

export class MissingRegistryAddressError extends Error {
  chainId: number
  network?: SelectableNetwork
  constructor(chainId: number) {
    const network = networkForChainId(chainId)
    super(`no default ERC-8004 registry on chain ${chainId}${network ? ` (${network})` : ''}`)
    this.name = 'MissingRegistryAddressError'
    this.chainId = chainId
    this.network = network
  }
}

const ERC8004_ABI = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)',
])

const REGISTERED_EVENT = parseAbiItem('event Registered(uint256 indexed agentId, address indexed owner, string agentURI)')
const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

type FetchLike = typeof fetch
type TransferLog = { args: { tokenId?: bigint } }
type ReceiptLog = { address?: Address; topics: readonly Hex[]; data: Hex }
type RegisterAgentPreflightClient = {
  estimateGas: (args: { account: Address; to: Address; data: Hex }) => Promise<bigint>
  getGasPrice: () => Promise<bigint>
  getBalance: (args: { address: Address }) => Promise<bigint>
}

export type Erc8004RegistryConfig = {
  chainId: number
  rpcUrl: string
  identityRegistryAddress: Address
  fromBlock?: bigint
}

export type EthagentBackupPointer = {
  cid: string
  envelopeVersion?: string
  createdAt?: string
  agentAddress?: Address
}

export type Erc8004AgentCandidate = {
  ownerAddress: Address
  chainId: number
  rpcUrl: string
  identityRegistryAddress: Address
  agentId: bigint
  agentUri: string
  metadataCid?: string
  name?: string
  description?: string
  backup?: EthagentBackupPointer
  registration: Record<string, unknown> | null
}

export type DiscoverOwnedAgentsArgs = Erc8004RegistryConfig & {
  ownerHandle: string
  ipfsApiUrl?: string
  publicClient?: PublicClient
  fetchImpl?: FetchLike
}

export type DiscoverOwnedAgentsAcrossSupportedNetworksArgs = {
  ownerHandle: string
  registryOverrides?: Erc8004RegistryConfig[]
  ipfsApiUrl?: string
  publicClients?: Partial<Record<number, PublicClient>>
  fetchImpl?: FetchLike
}

export type RegisterAgentPreflight = {
  gas: bigint
  gasPrice: bigint
  estimatedCostWei: bigint
  requiredBalanceWei: bigint
  balanceWei: bigint
}

export type RegisterAgentPreflightErrorCode = 'insufficient-funds' | 'simulation-failed'

export class RegisterAgentPreflightError extends Error {
  code: RegisterAgentPreflightErrorCode
  title: string
  detail: string
  hint: string
  requiredBalanceWei?: bigint
  balanceWei?: bigint

  constructor(args: {
    code: RegisterAgentPreflightErrorCode
    title: string
    detail: string
    hint: string
    requiredBalanceWei?: bigint
    balanceWei?: bigint
  }) {
    super(args.title)
    this.name = 'RegisterAgentPreflightError'
    this.code = args.code
    this.title = args.title
    this.detail = args.detail
    this.hint = args.hint
    this.requiredBalanceWei = args.requiredBalanceWei
    this.balanceWei = args.balanceWei
  }
}

export class AgentTokenIdRequiredError extends Error {
  ownerAddress: Address
  registry: Erc8004RegistryConfig
  balance: bigint

  constructor(args: {
    ownerAddress: Address
    registry: Erc8004RegistryConfig
    balance: bigint
    detail?: string
  }) {
    const chain = supportedErc8004ChainForId(args.registry.chainId)
    const label = chain?.network ?? chain?.name ?? `chain ${args.registry.chainId}`
    super(`${label} lookup timed out; enter the agent token id`)
    this.name = 'AgentTokenIdRequiredError'
    this.ownerAddress = args.ownerAddress
    this.registry = args.registry
    this.balance = args.balance
    if (args.detail) this.message = `${this.message}: ${cleanRpcError(args.detail)}`
  }
}

export function createErc8004PublicClient(args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'>): PublicClient {
  const transports = rpcUrlsForClient(args).map(url => http(url, { retryCount: 0, timeout: 8_000 }))
  return createPublicClient({
    chain: chainForId(args.chainId),
    transport: transports.length === 1 ? transports[0]! : fallback(transports, { retryCount: 0 }),
  })
}

export function supportedErc8004ChainForId(chainId: number): SupportedErc8004Chain | undefined {
  return SUPPORTED_ERC8004_CHAINS.find(chain => chain.chainId === chainId)
}

export function normalizeErc8004RegistryConfig(input: {
  chainId?: number
  rpcUrl?: string
  identityRegistryAddress?: string
  fromBlock?: string | bigint
}): Erc8004RegistryConfig {
  const chainId = input.chainId ?? DEFAULT_ERC8004_CHAIN_ID
  const chain = supportedErc8004ChainForId(chainId)
  const identityRegistryAddress = input.identityRegistryAddress?.trim() || chain?.identityRegistryAddress
  if (!identityRegistryAddress) throw new MissingRegistryAddressError(chainId)
  if (!isAddress(identityRegistryAddress)) throw new Error('invalid agent registry address')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.rpcUrl?.trim() || chain?.rpcUrl || DEFAULT_ETHEREUM_RPC_URL)
  } catch {
    throw new Error('invalid Ethereum RPC URL')
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Ethereum RPC URL must be http(s)')
  }
  return {
    chainId,
    rpcUrl: parsedUrl.toString().replace(/\/$/, ''),
    identityRegistryAddress: getAddress(identityRegistryAddress),
    fromBlock: input.fromBlock !== undefined ? BigInt(input.fromBlock) : chain?.fromBlock,
  }
}

export function erc8004ConfigForSupportedChain(chainId: number): Erc8004RegistryConfig {
  const chain = supportedErc8004ChainForId(chainId)
  if (!chain) throw new Error(`unsupported ERC-8004 chain id: ${chainId}`)
  return normalizeErc8004RegistryConfig(chain)
}

export async function resolveOwnerHandle(
  ownerHandle: string,
  args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'> & { publicClient?: PublicClient },
): Promise<Address> {
  const trimmed = ownerHandle.trim()
  if (isAddress(trimmed)) return getAddress(trimmed)
  if (!trimmed.includes('.')) throw new Error('enter an Ethereum address or ENS name')

  const publicClient = args.publicClient ?? createErc8004PublicClient(args)
  const resolved = await publicClient.getEnsAddress({ name: trimmed })
  if (!resolved) throw new Error(`ENS name did not resolve: ${trimmed}`)
  return getAddress(resolved)
}

export async function discoverOwnedAgentBackups(args: DiscoverOwnedAgentsArgs): Promise<Erc8004AgentCandidate[]> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args)
  const ownerAddress = await resolveOwnerHandle(args.ownerHandle, args)
  const fromBlock = args.fromBlock ?? supportedErc8004ChainForId(args.chainId)?.fromBlock ?? 0n
  const tokenIds = await findCandidateTokenIds({
    publicClient,
    registry: args,
    ownerAddress,
    fromBlock,
  })
  const out: Erc8004AgentCandidate[] = []
  for (const tokenId of tokenIds) {
    const candidate = await loadOwnedAgentCandidate({
      ...args,
      publicClient,
      ownerAddress,
      tokenId,
    }).catch(err => {
      if (err instanceof TokenOwnerMismatchError) return null
      throw err
    })
    if (candidate) out.push(candidate)
  }
  return out.sort((a, b) => Number(b.agentId - a.agentId))
}

export async function discoverOwnedAgentBackupByTokenId(args: DiscoverOwnedAgentsArgs & {
  tokenId: bigint
}): Promise<Erc8004AgentCandidate> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args)
  const ownerAddress = await resolveOwnerHandle(args.ownerHandle, args)
  return loadOwnedAgentCandidate({
    ...args,
    publicClient,
    ownerAddress,
    tokenId: args.tokenId,
  })
}

export async function discoverOwnedAgentBackupsAcrossSupportedNetworks(
  args: DiscoverOwnedAgentsAcrossSupportedNetworksArgs,
): Promise<Erc8004AgentCandidate[]> {
  const ownerAddress = await resolveOwnerAddressForSupportedLookup(args)
  const configs = SUPPORTED_ERC8004_CHAINS.map(chain => {
    const override = args.registryOverrides?.find(item => item.chainId === chain.chainId)
    return override ?? erc8004ConfigForSupportedChain(chain.chainId)
  })
  const results = await mapWithConcurrency(configs, DISCOVERY_CONCURRENCY, async config => {
    try {
      return {
        ok: true as const,
        candidates: await discoverOwnedAgentBackups({
          ...config,
          ownerHandle: ownerAddress,
          ipfsApiUrl: args.ipfsApiUrl,
          publicClient: args.publicClients?.[config.chainId],
          fetchImpl: args.fetchImpl,
        }),
      }
    } catch (err: unknown) {
      return { ok: false as const, error: err }
    }
  })

  const candidates = results.flatMap(result => result.ok ? result.candidates : [])
  if (candidates.length > 0) {
    return candidates.sort(compareCandidatesByNetworkThenNewest)
  }
  const failures = results.filter(result => !result.ok)
  const tokenIdRequired = failures
    .map(result => result.error)
    .find((err): err is AgentTokenIdRequiredError => err instanceof AgentTokenIdRequiredError)
  if (tokenIdRequired) throw tokenIdRequired
  if (failures.length === results.length && failures.length > 0) {
    throw new Error(`lookup failed on all supported networks: ${cleanRpcError(failures[0]!.error)}`)
  }
  return []
}

export async function loadAgentRegistration(
  uri: string,
  args: { ipfsApiUrl?: string; fetchImpl?: FetchLike } = {},
): Promise<{ metadataCid?: string; registration: Record<string, unknown> }> {
  const trimmed = uri.trim()
  let raw: string
  if (trimmed.startsWith('ipfs://')) {
    const cid = cidFromUri(trimmed)
    if (!cid) throw new Error('agentURI is missing an IPFS CID')
    raw = new TextDecoder().decode(await catFromIpfs(args.ipfsApiUrl ?? DEFAULT_IPFS_API_URL, cid))
    return { metadataCid: cid, registration: parseJsonObject(raw) }
  }
  if (trimmed.startsWith('data:')) {
    return { registration: parseJsonObject(decodeDataUri(trimmed)) }
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const response = await (args.fetchImpl ?? fetch)(trimmed)
    if (!response.ok) throw new Error(`agent metadata fetch failed: ${response.status} ${response.statusText}`)
    return { registration: parseJsonObject(await response.text()) }
  }
  throw new Error('unsupported agentURI scheme')
}

export function parseEthagentBackupPointer(registration: Record<string, unknown> | null): EthagentBackupPointer | null {
  if (!registration) return null
  const ext = objectField(registration, 'x-ethagent') ?? objectField(registration, 'ethagent')
  const backup = ext ? objectField(ext, 'backup') : null
  const cid = backup ? stringField(backup, 'cid') : undefined
  if (!cid) return null
  const agentAddress = stringField(ext, 'agentAddress')
  return {
    cid,
    envelopeVersion: backup ? stringField(backup, 'envelopeVersion') : undefined,
    createdAt: backup ? stringField(backup, 'createdAt') : undefined,
    ...(agentAddress && isAddress(agentAddress) ? { agentAddress: getAddress(agentAddress) } : {}),
  }
}

export function withEthagentBackupPointer(
  registration: Record<string, unknown> | null,
  backup: EthagentBackupPointer,
): Record<string, unknown> {
  const next: Record<string, unknown> = registration ? { ...registration } : {}
  const prior = objectField(next, 'x-ethagent') ?? {}
  next['x-ethagent'] = {
    ...prior,
    version: 1,
    ...(backup.agentAddress ? { agentAddress: backup.agentAddress } : {}),
    backup: {
      cid: backup.cid,
      ...(backup.envelopeVersion ? { envelopeVersion: backup.envelopeVersion } : {}),
      ...(backup.createdAt ? { createdAt: backup.createdAt } : {}),
    },
  }
  return next
}

export function encodeRegisterAgent(args: {
  agentURI: string
}): Hex {
  return encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: 'register',
    args: [args.agentURI],
  })
}

export async function preflightRegisterAgent(args: Erc8004RegistryConfig & {
  ownerAddress: Address
  agentURI: string
  publicClient?: RegisterAgentPreflightClient
}): Promise<RegisterAgentPreflight> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args) as RegisterAgentPreflightClient
  const data = encodeRegisterAgent({ agentURI: args.agentURI })
  let gas: bigint
  try {
    gas = await publicClient.estimateGas({
      account: args.ownerAddress,
      to: args.identityRegistryAddress,
      data,
    })
  } catch (err: unknown) {
    throw new RegisterAgentPreflightError({
      code: 'simulation-failed',
      title: 'registration blocked',
      detail: cleanRpcError(err),
      hint: 'No transaction was sent.',
    })
  }
  const [gasPrice, balance] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: args.ownerAddress }),
  ])
  const estimatedCost = gas * gasPrice
  const requiredBalance = estimatedCost + estimatedCost / 5n
  if (balance < requiredBalance) {
    throw new RegisterAgentPreflightError({
      code: 'insufficient-funds',
      title: 'not enough ETH',
      detail: `Need ~${formatEthAmount(requiredBalance)} ETH. Wallet has ${formatEthAmount(balance)} ETH.`,
      hint: 'Add ETH to this wallet, then try again.',
      requiredBalanceWei: requiredBalance,
      balanceWei: balance,
    })
  }
  return {
    gas,
    gasPrice,
    estimatedCostWei: estimatedCost,
    requiredBalanceWei: requiredBalance,
    balanceWei: balance,
  }
}

export async function preflightSetAgentUri(args: Erc8004RegistryConfig & {
  account: Address
  agentId: bigint
  newUri: string
  publicClient?: RegisterAgentPreflightClient
}): Promise<void> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args) as RegisterAgentPreflightClient
  const data = encodeSetAgentUri({ agentId: args.agentId, newUri: args.newUri })
  try {
    await publicClient.estimateGas({
      account: args.account,
      to: args.identityRegistryAddress,
      data,
    })
  } catch (err: unknown) {
    const detail = cleanRpcError(err)
    const looksLikeOwnershipRevert = /not.*owner|owner.*only|unauthor|forbidden|caller/i.test(detail)
    throw new RegisterAgentPreflightError({
      code: 'simulation-failed',
      title: 'snapshot blocked',
      detail,
      hint: looksLikeOwnershipRevert
        ? `Connect the wallet that owns this agent (${args.account}) and try again.`
        : 'No transaction was sent.',
    })
  }
}

export function encodeSetAgentUri(args: {
  agentId: bigint
  newUri: string
}): Hex {
  return encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: 'setAgentURI',
    args: [args.agentId, args.newUri],
  })
}

export function registeredAgentFromReceipt(args: {
  logs: ReceiptLog[]
  identityRegistryAddress: Address
  ownerAddress?: Address
}): { agentId: bigint; agentURI: string; owner: Address } {
  for (const log of args.logs) {
    if (log.address && log.address.toLowerCase() !== args.identityRegistryAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: [REGISTERED_EVENT],
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      })
      if (decoded.eventName !== 'Registered') continue
      const eventArgs = decoded.args as { agentId?: bigint; agentURI?: string; owner?: Address }
      if (eventArgs.agentId === undefined || !eventArgs.agentURI || !eventArgs.owner) continue
      if (args.ownerAddress && eventArgs.owner.toLowerCase() !== args.ownerAddress.toLowerCase()) continue
      return {
        agentId: eventArgs.agentId,
        agentURI: eventArgs.agentURI,
        owner: getAddress(eventArgs.owner),
      }
    } catch {
    }
  }
  throw new Error('ERC-8004 registration event was not found in transaction receipt')
}

export function cidFromUri(uri: string): string | undefined {
  if (!uri.startsWith('ipfs://')) return undefined
  const withoutScheme = uri.slice('ipfs://'.length)
  return withoutScheme.startsWith('ipfs/') ? withoutScheme.slice('ipfs/'.length) : withoutScheme
}

async function findCandidateTokenIds(args: {
  publicClient: PublicClient
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  fromBlock: bigint
}): Promise<bigint[]> {
  const tokenIds = new Set<bigint>()
  const balance = await args.publicClient.readContract({
    address: args.registry.identityRegistryAddress,
    abi: ERC8004_ABI,
    functionName: 'balanceOf',
    args: [args.ownerAddress],
  }) as bigint
  if (balance === 0n) return []

  try {
    for await (const logs of getTransferLogChunksBackwards({
      publicClient: args.publicClient,
      registry: args.registry,
      ownerAddress: args.ownerAddress,
      fromBlock: args.fromBlock,
    })) {
      for (const log of logs) {
        const tokenId = log.args.tokenId
        if (tokenId === undefined || tokenIds.has(tokenId)) continue
        if (await isCurrentTokenOwner(args.publicClient, args.registry.identityRegistryAddress, tokenId, args.ownerAddress)) {
          tokenIds.add(tokenId)
          if (BigInt(tokenIds.size) >= balance) return [...tokenIds]
        }
      }
    }
  } catch (err: unknown) {
    throw new AgentTokenIdRequiredError({
      ownerAddress: args.ownerAddress,
      registry: args.registry,
      balance,
      detail: cleanRpcError(err),
    })
  }
  if (BigInt(tokenIds.size) < balance) {
    throw new AgentTokenIdRequiredError({
      ownerAddress: args.ownerAddress,
      registry: args.registry,
      balance,
      detail: 'owned token ids were not found in logs',
    })
  }
  return [...tokenIds]
}

async function* getTransferLogChunksBackwards(args: {
  publicClient: PublicClient
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  fromBlock: bigint
}): AsyncGenerator<TransferLog[]> {
  const latest = await args.publicClient.getBlockNumber()
  if (args.fromBlock > latest) return
  for (const range of blockRangesBackwards(args.fromBlock, latest, logBlockRangeForChain(args.registry.chainId))) {
    const logs = await args.publicClient.getLogs({
      address: args.registry.identityRegistryAddress,
      event: TRANSFER_EVENT,
      args: { to: args.ownerAddress },
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    })
    yield logs as TransferLog[]
  }
}

async function findContractDeploymentBlock(publicClient: PublicClient, address: Address): Promise<bigint> {
  const latest = await publicClient.getBlockNumber()
  const latestCode = await publicClient.getBytecode({ address, blockNumber: latest })
  if (!latestCode || latestCode === '0x') throw new Error(`no contract code at ${address}`)

  let low = 0n
  let high = latest
  while (low < high) {
    const mid = (low + high) / 2n
    const code = await publicClient.getBytecode({ address, blockNumber: mid })
    if (code && code !== '0x') high = mid
    else low = mid + 1n
  }
  return low
}

class TokenOwnerMismatchError extends Error {
  constructor() {
    super('token is not owned by this wallet')
    this.name = 'TokenOwnerMismatchError'
  }
}

async function loadOwnedAgentCandidate(args: DiscoverOwnedAgentsArgs & {
  publicClient: PublicClient
  ownerAddress: Address
  tokenId: bigint
}): Promise<Erc8004AgentCandidate> {
  const currentOwner = await args.publicClient.readContract({
    address: args.identityRegistryAddress,
    abi: ERC8004_ABI,
    functionName: 'ownerOf',
    args: [args.tokenId],
  }) as Address
  if (currentOwner.toLowerCase() !== args.ownerAddress.toLowerCase()) {
    throw new TokenOwnerMismatchError()
  }
  const agentUri = await args.publicClient.readContract({
    address: args.identityRegistryAddress,
    abi: ERC8004_ABI,
    functionName: 'tokenURI',
    args: [args.tokenId],
  }) as string
  const loaded = await loadAgentRegistration(agentUri, {
    ipfsApiUrl: args.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
    fetchImpl: args.fetchImpl,
  }).catch(() => ({ metadataCid: cidFromUri(agentUri), registration: null }))
  const parsed = parseEthagentBackupPointer(loaded.registration)
  return {
    ownerAddress: args.ownerAddress,
    chainId: args.chainId,
    rpcUrl: args.rpcUrl,
    identityRegistryAddress: args.identityRegistryAddress,
    agentId: args.tokenId,
    agentUri,
    metadataCid: loaded.metadataCid,
    name: stringField(loaded.registration, 'name'),
    description: stringField(loaded.registration, 'description'),
    backup: parsed ?? undefined,
    registration: loaded.registration,
  }
}

async function isCurrentTokenOwner(
  publicClient: PublicClient,
  registry: Address,
  tokenId: bigint,
  ownerAddress: Address,
): Promise<boolean> {
  const currentOwner = await publicClient.readContract({
    address: registry,
    abi: ERC8004_ABI,
    functionName: 'ownerOf',
    args: [tokenId],
  }) as Address
  return currentOwner.toLowerCase() === ownerAddress.toLowerCase()
}

async function resolveOwnerAddressForSupportedLookup(
  args: DiscoverOwnedAgentsAcrossSupportedNetworksArgs,
): Promise<Address> {
  const trimmed = args.ownerHandle.trim()
  if (isAddress(trimmed)) return getAddress(trimmed)
  const mainnetConfig = erc8004ConfigForSupportedChain(mainnet.id)
  return resolveOwnerHandle(trimmed, {
    ...mainnetConfig,
    publicClient: args.publicClients?.[mainnet.id],
  })
}

async function mapWithConcurrency<input, output>(
  inputs: input[],
  concurrency: number,
  mapper: (input: input) => Promise<output>,
): Promise<output[]> {
  const out: output[] = new Array(inputs.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (next < inputs.length) {
      const index = next++
      out[index] = await mapper(inputs[index]!)
    }
  })
  await Promise.all(workers)
  return out
}

function compareCandidatesByNetworkThenNewest(a: Erc8004AgentCandidate, b: Erc8004AgentCandidate): number {
  const networkOrder = chainSortIndex(a.chainId) - chainSortIndex(b.chainId)
  if (networkOrder !== 0) return networkOrder
  return Number(b.agentId - a.agentId)
}

function blockRangesBackwards(
  fromBlock: bigint,
  latest: bigint,
  blockRange: bigint,
): Array<{ fromBlock: bigint; toBlock: bigint }> {
  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = []
  for (let end = latest; end >= fromBlock;) {
    const start = end - blockRange + 1n > fromBlock ? end - blockRange + 1n : fromBlock
    ranges.push({ fromBlock: start, toBlock: end })
    if (start === fromBlock) break
    end = start - 1n
  }
  return ranges
}

function logBlockRangeForChain(chainId: number): bigint {
  return supportedErc8004ChainForId(chainId)?.logBlockRange ?? 10_000n
}

function chainSortIndex(chainId: number): number {
  const index = SUPPORTED_ERC8004_CHAINS.findIndex(chain => chain.chainId === chainId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function rpcUrlsForClient(args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'>): string[] {
  const chain = supportedErc8004ChainForId(args.chainId)
  return uniqueStrings([
    args.rpcUrl,
    ...(chain && args.rpcUrl !== chain.rpcUrl ? [chain.rpcUrl] : []),
    ...(chain?.fallbackRpcUrls ?? []),
  ])
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim().replace(/\/$/, '')
    if (normalized && !out.includes(normalized)) out.push(normalized)
  }
  return out
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('agent metadata must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function decodeDataUri(uri: string): string {
  const comma = uri.indexOf(',')
  if (comma === -1) throw new Error('invalid data URI')
  const meta = uri.slice(0, comma)
  const body = uri.slice(comma + 1)
  return meta.endsWith(';base64')
    ? Buffer.from(body, 'base64').toString('utf8')
    : decodeURIComponent(body)
}

function objectField(input: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = input[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringField(input: Record<string, unknown> | null, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function cleanRpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message
    .replace(/\s+/g, ' ')
    .slice(0, 220)
}

function formatEthAmount(wei: bigint): string {
  const [whole = '0', fraction = ''] = formatEther(wei).split('.')
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, '')
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole
}

function chainEntry(
  chainId: number,
  name: string,
  rpcUrl: string,
  fallbackRpcUrls: string[],
  identityRegistryAddress: string | undefined,
  fromBlock: bigint | undefined,
  logBlockRange: bigint,
  kind: SupportedErc8004Chain['kind'],
  network: SelectableNetwork,
): SupportedErc8004Chain {
  return {
    chainId,
    name,
    rpcUrl: rpcUrl.replace(/\/$/, ''),
    fallbackRpcUrls: fallbackRpcUrls.map(url => url.replace(/\/$/, '')),
    ...(identityRegistryAddress ? { identityRegistryAddress: getAddress(identityRegistryAddress) } : {}),
    ...(fromBlock !== undefined ? { fromBlock } : {}),
    logBlockRange,
    kind,
    network,
  }
}

function chainForId(chainId: number): Chain | undefined {
  switch (chainId) {
    case mainnet.id:  return mainnet
    case arbitrum.id: return arbitrum
    case base.id:     return base
    case optimism.id: return optimism
    case polygon.id:  return polygon
    default:          return undefined
  }
}
