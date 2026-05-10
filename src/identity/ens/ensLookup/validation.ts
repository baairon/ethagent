import { getAddress, namehash, type Address } from 'viem'
import type { DiscoverOptions, EnsValidation } from './types.js'
import { ENS_REGISTRY_ABI, ENS_REGISTRY_ADDRESS_MAINNET, RPC_TIMEOUT_MS, ZERO_ADDRESS } from './constants.js'
import { createMainnetClient, withDeadline } from './client.js'
import { isEthDomain, splitSubdomainName } from './names.js'

export async function validateAgentEnsLink(
  fullName: string,
  expectedOwner: Address,
  opts: DiscoverOptions = {},
): Promise<EnsValidation> {
  if (!isEthDomain(fullName)) {
    return { ok: false, reason: 'lookup-failed', detail: 'not a valid .eth name' }
  }
  if (!splitSubdomainName(fullName)) {
    return { ok: false, reason: 'lookup-failed', detail: 'agent ENS name must be a subdomain, not a root .eth name' }
  }
  const client = opts.publicClient ?? createMainnetClient()
  const node = namehash(fullName)
  let resolver: Address
  try {
    const owner = await withDeadline(
      client.readContract({
        address: ENS_REGISTRY_ADDRESS_MAINNET,
        abi: ENS_REGISTRY_ABI,
        functionName: 'owner',
        args: [node],
      }),
      opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      'registry.owner',
      opts.signal,
    ) as Address
    if (owner === ZERO_ADDRESS) {
      return { ok: false, reason: 'no-owner', detail: 'name does not exist on ENS' }
    }
    resolver = await withDeadline(
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
    if (resolver === ZERO_ADDRESS) {
      return { ok: false, reason: 'no-resolver', detail: 'name has no resolver set' }
    }
  } catch (err) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  let resolved: Address | null
  try {
    resolved = await withDeadline(
      client.getEnsAddress({ name: fullName }),
      opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS,
      'getEnsAddress',
      opts.signal,
    )
  } catch (err) {
    return { ok: false, reason: 'lookup-failed', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!resolved) {
    return { ok: false, reason: 'address-mismatch', detail: 'name resolves to no address' }
  }
  const checksumResolved = getAddress(resolved)
  if (checksumResolved.toLowerCase() !== expectedOwner.toLowerCase()) {
    return { ok: false, reason: 'address-mismatch', detail: `name resolves to ${checksumResolved}` }
  }
  return { ok: true, resolvedAddress: checksumResolved, resolverAddress: getAddress(resolver) }
}
