import { getAddress, namehash, type Address } from 'viem'
import type { DiscoverOptions } from './types.js'
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDRESS_MAINNET, RESOLVER_ABI, RPC_TIMEOUT_MS, ZERO_ADDRESS } from './constants.js'
import { createMainnetClient, withDeadline } from './client.js'
import { isEthDomain, normalizeEthDomain } from './names.js'

export async function resolveEnsAddress(name: string, opts: DiscoverOptions = {}): Promise<Address | null> {
  const trimmed = normalizeEthDomain(name)
  if (!isEthDomain(trimmed)) return null
  const client = opts.publicClient ?? createMainnetClient()
  try {
    const addr = await withDeadline(
      client.getEnsAddress({ name: trimmed }),
      opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      'getEnsAddress',
      opts.signal,
    )
    return addr ? getAddress(addr) : null
  } catch {
    return null
  }
}

export async function readResolverAddress(fullName: string, opts: DiscoverOptions = {}): Promise<Address | null> {
  if (!isEthDomain(fullName)) return null
  const client = opts.publicClient ?? createMainnetClient()
  try {
    const node = namehash(fullName)
    const resolver = await withDeadline(
      client.readContract({
        address: ENS_REGISTRY_ADDRESS_MAINNET,
        abi: ENS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      }),
      opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      'registry.resolver',
      opts.signal,
    ) as Address
    return resolver === ZERO_ADDRESS ? null : resolver
  } catch {
    return null
  }
}

export async function readEthagentTextRecords(
  fullName: string,
  keys: readonly string[],
  opts: DiscoverOptions = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!isEthDomain(fullName)) return out
  const resolver = await readResolverAddress(fullName, opts)
  if (!resolver) return out
  const client = opts.publicClient ?? createMainnetClient()
  const node = namehash(fullName)
  for (const key of keys) {
    try {
      const value = await withDeadline(
        client.readContract({
          address: resolver,
          abi: RESOLVER_ABI,
          functionName: 'text',
          args: [node, key],
        }),
        opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
        `resolver.text(${key})`,
        opts.signal,
      ) as string
      if (value) out[key] = value
    } catch {
    }
  }
  return out
}
