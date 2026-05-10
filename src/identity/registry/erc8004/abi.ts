import { parseAbi, parseAbiItem } from 'viem'

export const ERC8004_ABI = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function setAgentURI(uint256 agentId, string newURI)',
  'function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)',
])

export const REGISTERED_EVENT = parseAbiItem('event Registered(uint256 indexed agentId, address indexed owner, string agentURI)')
export const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
