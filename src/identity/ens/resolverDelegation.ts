import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { ENS_AUTOMATION_RESOLVER_ABI } from './ensAutomation.js'

type ResolverDelegationReadClient = Pick<PublicClient, 'readContract'>

export type ResolverDelegationReadArgs = {
  client: ResolverDelegationReadClient
  resolverAddress: Address
  ownerAddress: Address
  node: Hex
  delegateAddress: Address
}

export function encodeApprove(node: Hex, delegateAddress: Address): Hex {
  return encodeFunctionData({
    abi: ENS_AUTOMATION_RESOLVER_ABI,
    functionName: 'approve',
    args: [node, getAddress(delegateAddress), true],
  })
}

export function encodeApprovalRevoke(node: Hex, delegateAddress: Address): Hex {
  return encodeFunctionData({
    abi: ENS_AUTOMATION_RESOLVER_ABI,
    functionName: 'approve',
    args: [node, getAddress(delegateAddress), false],
  })
}

export async function readDelegation(args: ResolverDelegationReadArgs): Promise<boolean> {
  try {
    const approved = await args.client.readContract({
      address: args.resolverAddress,
      abi: ENS_AUTOMATION_RESOLVER_ABI,
      functionName: 'isApprovedFor',
      args: [getAddress(args.ownerAddress), args.node, getAddress(args.delegateAddress)],
    }) as boolean
    return Boolean(approved)
  } catch {
    return false
  }
}
