import { getAddress, isAddress, type Address, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { DEFAULT_IPFS_API_URL } from '../../storage/ipfs.js'
import { isAgentInVault } from '../vault.js'
import { ERC8004_ABI, TRANSFER_EVENT } from './abi.js'
import {
  SUPPORTED_ERC8004_CHAINS,
  chainSortIndex,
  erc8004ConfigForSupportedChain,
  logBlockRangeForChain,
  minLogBlockRangeForChain,
  supportedErc8004ChainForId,
} from './chains.js'
import { createErc8004PublicClient } from './client.js'
import { parseEthagentBackupPointer, parseEthagentOperatorsPointer, parseEthagentPublicDiscoveryPointer } from './metadata.js'
import type { DiscoverOwnedAgentsAcrossSupportedNetworksArgs, DiscoverOwnedAgentsArgs, Erc8004AgentCandidate, Erc8004RegistryConfig, EthagentOperatorsPointer } from './types.js'
import { loadAgentRegistration } from './uri.js'
import { cleanRpcError, mapWithConcurrency } from './utils.js'
import { stringField } from '../fieldParsers.js'

const DISCOVERY_CONCURRENCY = 2

type TransferLog = { args: { tokenId?: bigint } }

export class AgentTokenIdRequiredError extends Error {
  ownerAddress: Address
  registry: Erc8004RegistryConfig
  balance: bigint
  detail?: string

  constructor(args: {
    ownerAddress: Address
    registry: Erc8004RegistryConfig
    balance: bigint
    detail?: string
    cause?: unknown
  }) {
    const chain = supportedErc8004ChainForId(args.registry.chainId)
    const label = chain?.network ?? chain?.name ?? `chain ${args.registry.chainId}`
    super(
      `Automatic ${label} token ownership lookup could not enumerate this wallet's ERC-8004 token IDs.`,
      args.cause === undefined ? undefined : { cause: args.cause },
    )
    this.name = 'AgentTokenIdRequiredError'
    this.ownerAddress = args.ownerAddress
    this.registry = args.registry
    this.balance = args.balance
    if (args.detail) this.detail = cleanRpcError(args.detail)
  }
}

async function resolveOwnerHandle(
  ownerHandle: string,
  args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'> & { publicClient?: PublicClient },
): Promise<Address> {
  const trimmed = ownerHandle.trim()
  if (isAddress(trimmed)) return getAddress(trimmed)
  if (!trimmed.includes('.')) throw new Error('Enter an Ethereum address or ENS name')

  const publicClient = args.publicClient ?? createErc8004PublicClient(args)
  const resolved = await publicClient.getEnsAddress({ name: trimmed })
  if (!resolved) throw new Error(`ENS name did not resolve: ${trimmed}`)
  return getAddress(resolved)
}

export async function discoverOwnedAgentBackups(args: DiscoverOwnedAgentsArgs): Promise<Erc8004AgentCandidate[]> {
  if (args.signal?.aborted) throw new DOMException('discovery cancelled', 'AbortError')
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
    if (args.signal?.aborted) throw new DOMException('discovery cancelled', 'AbortError')
    const candidate = await loadOwnedAgentCandidate({
      ...args,
      publicClient,
      ownerAddress,
      tokenId,
    }).catch(err => {
      if (err instanceof TokenOwnerMismatchError) return null
      if (err instanceof MetadataFetchError) return err.placeholder
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
          ...(args.signal ? { signal: args.signal } : {}),
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
  if (failures.length === results.length && failures.length > 0) {
    throw new Error(`lookup failed on all supported networks: ${cleanRpcError(failures[0]!.error)}`)
  }
  const tokenIdRequired = failures
    .map(result => result.error)
    .find((err): err is AgentTokenIdRequiredError => err instanceof AgentTokenIdRequiredError)
  if (tokenIdRequired) throw tokenIdRequired
  return []
}

async function findCandidateTokenIds(args: {
  publicClient: PublicClient
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  fromBlock: bigint
}): Promise<bigint[]> {
  const tokenIds = new Set<bigint>()
  let balance: bigint
  try {
    balance = await args.publicClient.readContract({
      address: args.registry.identityRegistryAddress,
      abi: ERC8004_ABI,
      functionName: 'balanceOf',
      args: [args.ownerAddress],
    }) as bigint
  } catch (err: unknown) {
    throw new AgentTokenIdRequiredError({
      ownerAddress: args.ownerAddress,
      registry: args.registry,
      balance: 0n,
      detail: cleanRpcError(err),
      cause: err,
    })
  }
  if (balance === 0n) return []

  const enumerableTokenIds = await findEnumerableTokenIds({
    publicClient: args.publicClient,
    registry: args.registry,
    ownerAddress: args.ownerAddress,
    balance,
  })
  if (enumerableTokenIds) return enumerableTokenIds

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
      cause: err,
    })
  }
  if (BigInt(tokenIds.size) < balance) {
    throw new AgentTokenIdRequiredError({
      ownerAddress: args.ownerAddress,
      registry: args.registry,
      balance,
      detail: 'Owned token ids were not found in logs',
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
  
  const ranges = blockRangesBackwards(args.fromBlock, latest, logBlockRangeForChain(args.registry.chainId))
  const CONCURRENCY = 5
  
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY)
    const logsArrays = await Promise.all(batch.map(async range => {
      try {
        return await getTransferLogsAdaptive({
          ...args,
          fromBlock: range.fromBlock,
          toBlock: range.toBlock,
          minBlockRange: minLogBlockRangeForChain(args.registry.chainId),
        })
      } catch {
        return [] as TransferLog[]
      }
    }))
    for (const logs of logsArrays) {
      if (logs.length > 0) yield logs
    }
  }
}

async function findEnumerableTokenIds(args: {
  publicClient: PublicClient
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  balance: bigint
}): Promise<bigint[] | null> {
  const tokenIds: bigint[] = []
  try {
    for (let index = 0n; index < args.balance; index += 1n) {
      const tokenId = await args.publicClient.readContract({
        address: args.registry.identityRegistryAddress,
        abi: ERC8004_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [args.ownerAddress, index],
      }) as bigint
      tokenIds.push(tokenId)
    }
    return tokenIds
  } catch {
    return null
  }
}

async function getTransferLogsAdaptive(args: {
  publicClient: PublicClient
  registry: Erc8004RegistryConfig
  ownerAddress: Address
  fromBlock: bigint
  toBlock: bigint
  minBlockRange: bigint
}): Promise<TransferLog[]> {
  const size = args.toBlock - args.fromBlock + 1n
  try {
    const logs = await args.publicClient.getLogs({
      address: args.registry.identityRegistryAddress,
      event: TRANSFER_EVENT,
      args: { to: args.ownerAddress },
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
    })
    return logs as TransferLog[]
  } catch (err: unknown) {
    if (size <= args.minBlockRange) throw err
    const mid = args.fromBlock + size / 2n - 1n
    const [newer, older] = await Promise.all([
      getTransferLogsAdaptive({ ...args, fromBlock: mid + 1n, toBlock: args.toBlock }),
      getTransferLogsAdaptive({ ...args, fromBlock: args.fromBlock, toBlock: mid }),
    ])
    return [...newer, ...older]
  }
}

class TokenOwnerMismatchError extends Error {
  constructor() {
    super('Wallet is not the token owner or an operator wallet')
    this.name = 'TokenOwnerMismatchError'
  }
}

export class MetadataFetchError extends Error {
  readonly tokenId: bigint
  readonly agentUri: string
  override readonly cause: unknown
  // Set when the chain alone proves the requester holds the token, so a wallet-wide
  // search can still list it instead of failing on one unreadable profile.
  readonly placeholder: Erc8004AgentCandidate | null
  constructor(tokenId: bigint, agentUri: string, cause: unknown, placeholder: Erc8004AgentCandidate | null = null) {
    super(`The profile for token #${tokenId.toString()} did not download. ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MetadataFetchError'
    this.tokenId = tokenId
    this.agentUri = agentUri
    this.cause = cause
    this.placeholder = placeholder
  }
}

function isAuthorizedAgentLookupAddress(args: {
  requesterAddress: Address
  tokenOwnerAddress: Address
  operators: EthagentOperatorsPointer | null
}): boolean {
  const requester = args.requesterAddress.toLowerCase()
  if (args.tokenOwnerAddress.toLowerCase() === requester) return true
  if (args.operators?.activeOperatorAddress?.toLowerCase() === requester) return true
  return args.operators?.approvedOperatorWallets.some(record => record.address.toLowerCase() === requester) ?? false
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
  const agentUri = await args.publicClient.readContract({
    address: args.identityRegistryAddress,
    abi: ERC8004_ABI,
    functionName: 'tokenURI',
    args: [args.tokenId],
  }) as string

  const tokenOwnerAddress = getAddress(currentOwner)
  const vaultLevelOwner = await readVaultLevelOwner(args, tokenOwnerAddress)
  let loaded: { metadataCid?: string; registration: Record<string, unknown> }
  try {
    loaded = await loadAgentRegistration(agentUri, {
      ipfsApiUrl: args.ipfsApiUrl ?? DEFAULT_IPFS_API_URL,
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
      ...(args.signal ? { signal: args.signal } : {}),
    })
  } catch (err: unknown) {
    if (args.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) throw err
    const requester = args.ownerAddress.toLowerCase()
    const holdsToken = tokenOwnerAddress.toLowerCase() === requester || vaultLevelOwner?.toLowerCase() === requester
    throw new MetadataFetchError(args.tokenId, agentUri, err, holdsToken
      ? {
          tokenOwnerAddress,
          ownerAddress: vaultLevelOwner ?? tokenOwnerAddress,
          chainId: args.chainId,
          rpcUrl: args.rpcUrl,
          identityRegistryAddress: args.identityRegistryAddress,
          agentId: args.tokenId,
          agentUri,
          registration: null,
          metadataError: err instanceof Error ? err.message : String(err),
        }
      : null)
  }
  const parsed = parseEthagentBackupPointer(loaded.registration)
  const publicDiscovery = parseEthagentPublicDiscoveryPointer(loaded.registration)
  const operators = parseEthagentOperatorsPointer(loaded.registration)
  if (!isAuthorizedAgentLookupAddress({
    requesterAddress: args.ownerAddress,
    tokenOwnerAddress,
    operators,
  })) {
    if (!vaultLevelOwner || vaultLevelOwner.toLowerCase() !== args.ownerAddress.toLowerCase()) {
      throw new TokenOwnerMismatchError()
    }
  }
  const ownerAddress = vaultLevelOwner ?? tokenOwnerAddress
  return {
    tokenOwnerAddress,
    ownerAddress,
    chainId: args.chainId,
    rpcUrl: args.rpcUrl,
    identityRegistryAddress: args.identityRegistryAddress,
    agentId: args.tokenId,
    agentUri,
    metadataCid: loaded.metadataCid,
    name: stringField(loaded.registration, 'name'),
    description: stringField(loaded.registration, 'description'),
    imageUrl: stringField(loaded.registration, 'image'),
    backup: parsed ?? undefined,
    publicDiscovery: publicDiscovery ?? undefined,
    operators: operators ?? undefined,
    registration: loaded.registration,
  }
}

async function readVaultLevelOwner(
  args: { publicClient: PublicClient; identityRegistryAddress: Address; tokenId: bigint },
  tokenOwnerAddress: Address,
): Promise<Address | undefined> {
  try {
    const status = await isAgentInVault({
      client: args.publicClient,
      vaultAddress: tokenOwnerAddress,
      registry: args.identityRegistryAddress,
      agentId: args.tokenId,
    })
    return status.inVault && status.ownerAddress ? status.ownerAddress : undefined
  } catch {
    return undefined
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
