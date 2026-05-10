import { parseAbi, type Address } from 'viem'

export const RPC_TIMEOUT_MS = 8_000

export const ENS_REGISTRY_ADDRESS_MAINNET = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

export const ENS_RPC_URLS = [
  'https://ethereum.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
] as const

export const ETH_NAME_PATTERN = /^([a-z0-9-]+.)+eth$/i

export const ENS_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
])

export const RESOLVER_ABI = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[])',
])
