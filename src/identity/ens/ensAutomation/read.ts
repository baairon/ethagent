import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { createMainnetClient } from '../ensLookup/client.js'
import { isChainAnswer } from '../../../net/paced.js'
import {
  recordsFromTextMap,
  type AgentEnsRecordState,
} from '../agentRecords.js'
import {
  ENS_AUTOMATION_NAME_WRAPPER_ABI,
  ENS_AUTOMATION_REGISTRY_ABI,
  ENS_AUTOMATION_RESOLVER_ABI,
  ENS_NAME_WRAPPER_ADDRESS_MAINNET,
  ENS_REGISTRY_ADDRESS_MAINNET,
  ZERO_ADDRESS,
} from './contracts.js'
import type { EnsAutomationReadClient } from './types.js'

export function shortHex(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function createEnsAutomationClient(): PublicClient {
  return createMainnetClient()
}

export async function readOwner(client: EnsAutomationReadClient, node: Hex): Promise<Address> {
  const owner = await client.readContract({
    address: ENS_REGISTRY_ADDRESS_MAINNET,
    abi: ENS_AUTOMATION_REGISTRY_ABI,
    functionName: 'owner',
    args: [node],
  }) as Address
  return getAddress(owner)
}

export async function readResolver(client: EnsAutomationReadClient, node: Hex): Promise<Address> {
  const resolver = await client.readContract({
    address: ENS_REGISTRY_ADDRESS_MAINNET,
    abi: ENS_AUTOMATION_REGISTRY_ABI,
    functionName: 'resolver',
    args: [node],
  }) as Address
  return getAddress(resolver)
}

export async function readWrappedOwner(client: EnsAutomationReadClient, node: Hex): Promise<Address> {
  const owner = await client.readContract({
    address: ENS_NAME_WRAPPER_ADDRESS_MAINNET,
    abi: ENS_AUTOMATION_NAME_WRAPPER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(node)],
  }) as Address
  return getAddress(owner)
}

export async function readAddressRecord(client: EnsAutomationReadClient, resolverAddress: Address, node: Hex): Promise<Address | null> {
  try {
    const addr = await client.readContract({
      address: resolverAddress,
      abi: ENS_AUTOMATION_RESOLVER_ABI,
      functionName: 'addr',
      args: [node],
    }) as Address
    return isZero(addr) ? null : getAddress(addr)
  } catch (err: unknown) {
    // A resolver without addr() answers with a revert: no record. An unanswered read
    // is an error, never "no record".
    if (isChainAnswer(err)) return null
    throw err
  }
}

export async function readTextRecords(
  client: EnsAutomationReadClient,
  resolverAddress: Address,
  node: Hex,
  keys: readonly string[],
): Promise<AgentEnsRecordState> {
  const text: Record<string, string> = {}
  for (const key of keys) {
    try {
      const value = await client.readContract({
        address: resolverAddress,
        abi: ENS_AUTOMATION_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      }) as string
      if (value) text[key] = value
    } catch (err: unknown) {
      if (!isChainAnswer(err)) throw err
    }
  }
  return recordsFromTextMap(text)
}

export function isZero(address: Address): boolean {
  return address.toLowerCase() === ZERO_ADDRESS
}

export function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
