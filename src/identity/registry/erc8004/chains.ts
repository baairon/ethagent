import { getAddress, isAddress, type Address, type Chain } from 'viem'
import { base, mainnet } from 'viem/chains'
import type { SelectableNetwork } from '../../../storage/config.js'
import type { Erc8004RegistryConfig } from './types.js'
import { uniqueStrings } from './utils.js'

export const DEFAULT_ERC8004_CHAIN_ID = 1
export const DEFAULT_ETHEREUM_RPC_URL = 'https://ethereum.publicnode.com'
export const DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

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
  chainEntry(mainnet.id, 'Ethereum Mainnet', DEFAULT_ETHEREUM_RPC_URL,    [],                              DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 24_339_871n, 10_000n, 'mainnet', 'mainnet'),
  chainEntry(base.id,    'Base',             'https://mainnet.base.org', ['https://base.publicnode.com'], DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS, 41_663_783n, 10_000n, 'l2',      'base'),
]

const NETWORK_TO_CHAIN_ID: Record<SelectableNetwork, number> = {
  mainnet: mainnet.id,
  base:    base.id,
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
    super('no default ERC-8004 registry onchain ' + chainId + (network ? ' (' + network + ')' : ''))
    this.name = 'MissingRegistryAddressError'
    this.chainId = chainId
    this.network = network
  }
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
  if (!isAddress(identityRegistryAddress)) throw new Error('Invalid agent registry address')
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.rpcUrl?.trim() || chain?.rpcUrl || DEFAULT_ETHEREUM_RPC_URL)
  } catch {
    throw new Error('Invalid Ethereum RPC URL')
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
  if (!chain) throw new Error('Unsupported ERC-8004 chain id: ' + chainId)
  return normalizeErc8004RegistryConfig(chain)
}

export function chainSortIndex(chainId: number): number {
  const index = SUPPORTED_ERC8004_CHAINS.findIndex(chain => chain.chainId === chainId)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export function logBlockRangeForChain(chainId: number): bigint {
  const chain = supportedErc8004ChainForId(chainId)
  if (!chain) return 10_000n
  return chain.logBlockRange
}

export function minLogBlockRangeForChain(chainId: number): bigint {
  const chain = supportedErc8004ChainForId(chainId)
  if (!chain) return 2_000n
  return chain.kind === 'l2' ? chain.logBlockRange : chain.logBlockRange / 2n || 1n
}

export function rpcUrlsForClient(args: Pick<Erc8004RegistryConfig, 'chainId' | 'rpcUrl'>): string[] {
  const chain = supportedErc8004ChainForId(args.chainId)
  return uniqueStrings([
    args.rpcUrl,
    ...(chain && args.rpcUrl !== chain.rpcUrl ? [chain.rpcUrl] : []),
    ...(chain?.fallbackRpcUrls ?? []),
  ])
}

export function chainForId(chainId: number): Chain | undefined {
  switch (chainId) {
    case mainnet.id: return mainnet
    case base.id:    return base
    default:         return undefined
  }
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
