import { getAddress, type Address } from 'viem'
import {
  createErc8004PublicClient,
  validateErc8004TokenOwner,
  type Erc8004RegistryConfig,
} from '../../../registry/erc8004.js'
import type { EthagentIdentity } from '../../../../storage/config.js'

export type OwnershipRole = 'token-holder' | 'vault-level-owner'

export type OwnershipGuardResult =
  | { ok: true; effectiveOwner: Address; heldByVault: boolean }
  | { ok: false; reason: 'not-owned' | 'lookup-failed'; detail: string; onChainOwner?: Address }

type OwnershipCacheEntry = {
  expiresAt: number
  result: OwnershipGuardResult
}

const OWNERSHIP_CACHE_TTL_MS = 30_000
const ownershipCache = new Map<string, OwnershipCacheEntry>()

function ownershipCacheKey(args: {
  registry: Erc8004RegistryConfig
  agentId: bigint
  expectedSigner: Address
  requiredRole: OwnershipRole
}): string {
  return [
    args.registry.chainId,
    args.registry.identityRegistryAddress.toLowerCase(),
    args.agentId.toString(),
    args.expectedSigner.toLowerCase(),
    args.requiredRole,
  ].join('|')
}

export function invalidateOwnershipCache(): void {
  ownershipCache.clear()
}

export async function preflightTokenOwnership(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  operatorVaults?: Readonly<Record<string, string>>
  requiredRole: OwnershipRole
  expectedSigner?: Address
}): Promise<OwnershipGuardResult> {
  if (!args.identity.agentId) {
    return { ok: false, reason: 'lookup-failed', detail: 'identity has no agentId' }
  }
  const expectedSigner = getAddress(args.expectedSigner ?? args.identity.ownerAddress ?? args.identity.address)
  const agentId = BigInt(args.identity.agentId)
  const key = ownershipCacheKey({ registry: args.registry, agentId, expectedSigner, requiredRole: args.requiredRole })
  const cached = ownershipCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.result
  const result = await runOwnershipPreflight({ ...args, agentId, expectedSigner })
  ownershipCache.set(key, { result, expiresAt: Date.now() + OWNERSHIP_CACHE_TTL_MS })
  return result
}

async function runOwnershipPreflight(args: {
  registry: Erc8004RegistryConfig
  operatorVaults?: Readonly<Record<string, string>>
  requiredRole: OwnershipRole
  agentId: bigint
  expectedSigner: Address
}): Promise<OwnershipGuardResult> {
  const validation = await validateErc8004TokenOwner({
    ...args.registry,
    agentId: args.agentId,
    expectedOwner: args.expectedSigner,
    operatorVaults: args.operatorVaults,
  })
  if (validation.ok) {
    const directOwner = await readDirectOwner({
      registry: args.registry,
      agentId: args.agentId,
    })
    if (directOwner.kind === 'error') {
      return { ok: false, reason: 'lookup-failed', detail: directOwner.detail }
    }
    const heldByVault = directOwner.owner.toLowerCase() !== args.expectedSigner.toLowerCase()
    if (args.requiredRole === 'token-holder' && heldByVault) {
      return {
        ok: false,
        reason: 'not-owned',
        detail: `Token is held by the OperatorVault (${directOwner.owner}). Withdraw it first.`,
        onChainOwner: directOwner.owner,
      }
    }
    return { ok: true, effectiveOwner: validation.ownerAddress, heldByVault }
  }
  if (validation.reason === 'token-owner-lookup-failed') {
    return { ok: false, reason: 'lookup-failed', detail: validation.detail }
  }
  return {
    ok: false,
    reason: 'not-owned',
    detail: validation.detail,
    onChainOwner: validation.ownerAddress,
  }
}

async function readDirectOwner(args: {
  registry: Erc8004RegistryConfig
  agentId: bigint
}): Promise<{ kind: 'ok'; owner: Address } | { kind: 'error'; detail: string }> {
  try {
    const client = createErc8004PublicClient(args.registry)
    const owner = await client.readContract({
      address: args.registry.identityRegistryAddress,
      abi: [
        {
          type: 'function',
          name: 'ownerOf',
          stateMutability: 'view',
          inputs: [{ name: 'tokenId', type: 'uint256' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ] as const,
      functionName: 'ownerOf',
      args: [args.agentId],
    })
    return { kind: 'ok', owner: getAddress(owner as Address) }
  } catch (err: unknown) {
    return { kind: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}
