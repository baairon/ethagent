import { getAddress, namehash, type Address } from 'viem'
import type { DiscoverOptions } from './types.js'
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDRESS_MAINNET, RESOLVER_ABI, ZERO_ADDRESS } from './constants.js'
import { createMainnetClient, cancellable } from './client.js'
import { isEthDomain, normalizeEthDomain } from './names.js'

export async function resolveEnsAddress(name: string, opts: DiscoverOptions = {}): Promise<Address | null> {
  const trimmed = normalizeEthDomain(name)
  if (!isEthDomain(trimmed)) return null
  const client = opts.publicClient ?? createMainnetClient()
  try {
    const addr = await cancellable(
      client.getEnsAddress({ name: trimmed }),
      opts.signal,
    )
    return typeof addr === 'string' ? getAddress(addr) : null
  } catch {
    return null
  }
}

// null means the registry has no resolver for the name. A read that fails throws: an
// unreadable resolver is not "no resolver".
export async function readResolverAddress(fullName: string, opts: DiscoverOptions = {}): Promise<Address | null> {
  if (!isEthDomain(fullName)) return null
  const client = opts.publicClient ?? createMainnetClient()
  const node = namehash(fullName)
  const resolver = await cancellable(
    client.readContract({
      address: ENS_REGISTRY_ADDRESS_MAINNET,
      abi: ENS_REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    }),
    opts.signal,
  ) as Address
  return resolver === ZERO_ADDRESS ? null : resolver
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
  // An empty value means the record is unset. A read that fails throws, so a caller
  // clearing records never skips a key it could not read.
  for (const key of keys) {
    const value = await cancellable(
      client.readContract({
        address: resolver,
        abi: RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      }),
      opts.signal,
    ) as string
    if (value) out[key] = value
  }
  return out
}
