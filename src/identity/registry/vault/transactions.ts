import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from 'viem'
import { VAULT_ABI } from './constants.js'

const ERC721_SAFE_TRANSFER_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
])

export type DepositAgentArgs = {
  registry: Address
  agentId: bigint
  walletAddress: Address
  vaultAddress: Address
}

export function encodeDepositAgent(args: DepositAgentArgs): { to: Address; data: Hex } {
  return {
    to: getAddress(args.registry),
    data: encodeFunctionData({
      abi: ERC721_SAFE_TRANSFER_ABI,
      functionName: 'safeTransferFrom',
      args: [getAddress(args.walletAddress), getAddress(args.vaultAddress), args.agentId],
    }),
  }
}

export type SetMetadataOperatorArgs = {
  registry: Address
  agentId: bigint
  operator: Address
  approved: boolean
  vaultAddress: Address
}

export function encodeSetMetadataOperator(args: SetMetadataOperatorArgs): { to: Address; data: Hex } {
  return {
    to: getAddress(args.vaultAddress),
    data: encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'setMetadataOperator',
      args: [getAddress(args.registry), args.agentId, getAddress(args.operator), args.approved],
    }),
  }
}

export type RotateAgentURIArgs = {
  registry: Address
  agentId: bigint
  newURI: string
  vaultAddress: Address
}

export function encodeRotateAgentURI(args: RotateAgentURIArgs): { to: Address; data: Hex } {
  return {
    to: getAddress(args.vaultAddress),
    data: encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'rotateAgentURI',
      args: [getAddress(args.registry), args.agentId, args.newURI],
    }),
  }
}

export type UnwrapAgentArgs = {
  registry: Address
  agentId: bigint
  recipient: Address
  vaultAddress: Address
}

export function encodeUnwrapAgent(
  args: UnwrapAgentArgs,
): { to: Address; data: Hex } {
  return {
    to: getAddress(args.vaultAddress),
    data: encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'unwrap',
      args: [getAddress(args.registry), args.agentId, args.recipient],
    }),
  }
}
