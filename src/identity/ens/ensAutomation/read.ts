import {
  createPublicClient,
  fallback,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'
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
  ENS_RPC_URLS,
  ZERO_ADDRESS,
} from './contracts.js'
import type { EnsAutomationReadClient } from './types.js'

export function shortHex(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function createEnsAutomationClient(): PublicClient {
  const transports = ENS_RPC_URLS.map(url => http(url, { retryCount: 0, timeout: 8_000 }))
  return createPublicClient({
    chain: mainnet,
    transport: transports.length === 1 ? transports[0]! : fallback(transports, { retryCount: 0 }),
  })
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
  } catch {
    return null
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
    } catch {
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
