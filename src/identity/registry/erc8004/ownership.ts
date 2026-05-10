import { getAddress, type Address, type PublicClient } from 'viem'
import { OPERATOR_VAULT_ABI } from '../operatorVault.js'
import { ERC8004_ABI } from './abi.js'
import { createErc8004PublicClient } from './client.js'
import type { Erc8004RegistryConfig } from './types.js'

type TokenOwnerReadClient = Pick<PublicClient, 'readContract'>

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

async function readErc8004TokenOwner(args: Erc8004RegistryConfig & {
  agentId: bigint
  publicClient?: TokenOwnerReadClient
}): Promise<Address> {
  const publicClient = args.publicClient ?? createErc8004PublicClient(args)
  const owner = await publicClient.readContract({
    address: args.identityRegistryAddress,
    abi: ERC8004_ABI,
    functionName: 'ownerOf',
    args: [args.agentId],
  }) as Address
  return getAddress(owner)
}

export type Erc8004TokenOwnerValidation =
  | { ok: true; ownerAddress: Address }
  | { ok: false; reason: 'token-owner-mismatch' | 'token-owner-lookup-failed'; ownerAddress?: Address; detail: string }

export async function validateErc8004TokenOwner(args: Erc8004RegistryConfig & {
  agentId: bigint
  expectedOwner: Address
  publicClient?: TokenOwnerReadClient
  operatorVaults?: Readonly<Record<string, string>>
}): Promise<Erc8004TokenOwnerValidation> {
  let owner: Address
  try {
    owner = await readErc8004TokenOwner(args)
  } catch (err: unknown) {
    return {
      ok: false,
      reason: 'token-owner-lookup-failed',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
  const expectedOwner = getAddress(args.expectedOwner)
  if (owner.toLowerCase() === expectedOwner.toLowerCase()) {
    return { ok: true, ownerAddress: owner }
  }
  const vaultOwnerResult = await readVaultLevelOwner({
    ...args,
    vaultAddress: owner,
  })
  if (vaultOwnerResult.kind === 'empty') {
    return {
      ok: false,
      reason: 'token-owner-lookup-failed',
      detail: `ERC-8004 token #${args.agentId.toString()} is still reported at the OperatorVault, but that vault record is empty. Ownership is still settling; retry shortly.`,
    }
  }
  if (vaultOwnerResult.kind === 'error') {
    return {
      ok: false,
      reason: 'token-owner-lookup-failed',
      detail: vaultOwnerResult.error instanceof Error ? vaultOwnerResult.error.message : String(vaultOwnerResult.error),
    }
  }
  if (vaultOwnerResult.kind === 'ok') {
    const vaultOwner = vaultOwnerResult.ownerAddress
    if (vaultOwner.toLowerCase() === expectedOwner.toLowerCase()) {
      return { ok: true, ownerAddress: vaultOwner }
    }
    return {
      ok: false,
      reason: 'token-owner-mismatch',
      ownerAddress: vaultOwner,
      detail: `ERC-8004 token #${args.agentId.toString()} is held by the OperatorVault for ${vaultOwner}`,
    }
  }
  return {
    ok: false,
    reason: 'token-owner-mismatch',
    ownerAddress: owner,
    detail: `ERC-8004 token #${args.agentId.toString()} is owned by ${shortHex(owner)}`,
  }
}

async function readVaultLevelOwner(args: Erc8004RegistryConfig & {
  agentId: bigint
  vaultAddress: Address
  publicClient?: TokenOwnerReadClient
}): Promise<
  | { kind: 'ok'; ownerAddress: Address }
  | { kind: 'empty' }
  | { kind: 'not-vault' }
  | { kind: 'error'; error: unknown }
> {
  try {
    const client = args.publicClient ?? createErc8004PublicClient(args)
    const vaultOwner = await client.readContract({
      address: args.vaultAddress,
      abi: OPERATOR_VAULT_ABI,
      functionName: 'agentOwner',
      args: [args.identityRegistryAddress, args.agentId],
    }) as Address
    const normalizedVaultOwner = getAddress(vaultOwner)
    if (normalizedVaultOwner.toLowerCase() === ZERO_ADDRESS) return { kind: 'empty' }
    return { kind: 'ok', ownerAddress: normalizedVaultOwner }
  } catch (err: unknown) {
    return looksLikeTransientVaultReadFailure(err) ? { kind: 'error', error: err } : { kind: 'not-vault' }
  }
}

function looksLikeTransientVaultReadFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /timeout|network|header not found|rate|server|rpc/i.test(message)
}

function shortHex(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
