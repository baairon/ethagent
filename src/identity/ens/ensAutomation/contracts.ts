import { parseAbi, type Address } from 'viem'

export const ENS_REGISTRY_ADDRESS_MAINNET = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as Address
export const ENS_NAME_WRAPPER_ADDRESS_MAINNET = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401' as Address
export const ENS_PUBLIC_RESOLVER_ADDRESS_MAINNET = '0xF29100983E058B709F3D539b0c765937B804AC15' as Address
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address
export const DEFAULT_TTL = 0n
export const DEFAULT_FUSES = 0
export const DEFAULT_EXPIRY = 0n

export const ENS_RPC_URLS = [
  'https://ethereum.publicnode.com',
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
] as const

export const ENS_AUTOMATION_REGISTRY_ABI = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setResolver(bytes32 node, address resolver)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
])

export const ENS_AUTOMATION_RESOLVER_ABI = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function text(bytes32 node, string key) view returns (string)',
  'function setAddr(bytes32 node, address addr)',
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[])',
  'function approve(bytes32 node, address delegate, bool approved)',
  'function isApprovedFor(address owner, bytes32 node, address delegate) view returns (bool)',
])

export const ENS_AUTOMATION_NAME_WRAPPER_ABI = parseAbi([
  'function ownerOf(uint256 id) view returns (address)',
  'function setResolver(bytes32 node, address resolver)',
  'function setSubnodeRecord(bytes32 parentNode, string label, address owner, address resolver, uint64 ttl, uint32 fuses, uint64 expiry)',
])
