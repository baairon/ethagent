import type { Address } from 'viem'
import type { DiscoverOptions, EnsNameDiscoveryResult } from './types.js'
import { RPC_TIMEOUT_MS } from './constants.js'
import { createMainnetClient } from './client.js'
import { isEthDomain, normalizeEthDomain, splitSubdomainName } from './names.js'

export async function discoverOwnedEnsNames(
  ownerAddress: Address,
  opts: DiscoverOptions = {},
): Promise<string[]> {
  const result = await discoverOwnedEnsNameDetails(ownerAddress, opts)
  return result.names
}

export async function discoverOwnedEnsNameDetails(
  ownerAddress: Address,
  opts: DiscoverOptions = {},
): Promise<EnsNameDiscoveryResult> {
  const rpcTimeoutMs = opts.rpcTimeoutMs ?? RPC_TIMEOUT_MS
  const controller = new AbortController()
  const onParentAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onParentAbort, { once: true })
  const budgetTimer = setTimeout(() => controller.abort(), rpcTimeoutMs)
  try {
    const client = opts.publicClient ?? createMainnetClient()
    if (controller.signal.aborted) {
      return { status: 'error', names: [], sourcesChecked: [], errors: ['ENS name lookup was cancelled'] }
    }
    try {
      const primary = await client.getEnsName({ address: ownerAddress })
      const names = new Set<string>()
      if (primary) {
        const normalized = normalizeEthDomain(primary)
        if (normalized && normalized.endsWith('.eth')) {
          if (isRootEthName(normalized)) {
            names.add(normalized)
          } else {
            const parts = splitSubdomainName(normalized)
            if (parts && isRootEthName(parts.parent)) names.add(parts.parent)
          }
        }
      }
      return {
        status: 'ok',
        names: [...names].sort((a, b) => a.localeCompare(b)),
        sourcesChecked: ['ENS reverse resolver'],
        errors: [],
      }
    } catch (err) {
      return {
        status: 'error',
        names: [],
        sourcesChecked: [],
        errors: [formatDiscoveryError(err)],
      }
    }
  } finally {
    clearTimeout(budgetTimer)
    opts.signal?.removeEventListener('abort', onParentAbort)
  }
}

function formatDiscoveryError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isRootEthName(value: string): boolean {
  const normalized = normalizeEthDomain(value)
  return isEthDomain(normalized) && normalized.split('.').length === 2
}
