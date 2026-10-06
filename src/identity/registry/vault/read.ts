import { getAddress, parseAbi, type Address, type PublicClient } from 'viem'
import { VAULT_ABI } from './constants.js'
import { pacingOptions, type VaultCheckPacing } from './bytecode.js'
import { isChainAnswer, pacedConfirm, PacedTimeoutError } from '../../../net/paced.js'

export type VaultReadClient = Pick<PublicClient, 'readContract'>

const ERC721_OWNER_OF_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
])

export type DiscoverPriorVaultClient = Pick<PublicClient, 'readContract' | 'getBytecode'>

export type DiscoverPriorVaultArgs = {
  client: DiscoverPriorVaultClient
  registry: Address
  agentId: bigint
  expectedOwner: Address
}

export async function discoverPriorVaultFromTokenOwner(
  args: DiscoverPriorVaultArgs,
): Promise<{ found: false } | { found: true; vaultAddress: Address }> {
  const registryAddr = getAddress(args.registry)
  const expected = getAddress(args.expectedOwner).toLowerCase()
  const tokenOwner = await args.client.readContract({
    address: registryAddr,
    abi: ERC721_OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [args.agentId],
  }) as Address
  if (!tokenOwner || tokenOwner.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { found: false }
  }
  if (tokenOwner.toLowerCase() === expected) {
    return { found: false }
  }
  const candidate = getAddress(tokenOwner)
  const code = await args.client.getBytecode({ address: candidate })
  if (!code || code === '0x') return { found: false }
  let vaultLevelOwner: Address
  try {
    vaultLevelOwner = await args.client.readContract({
      address: candidate,
      abi: VAULT_ABI,
      functionName: 'agentOwner',
      args: [registryAddr, args.agentId],
    }) as Address
  } catch (err: unknown) {
    // A contract that answers agentOwner with a revert or no data is not a Vault. Any
    // other failure is an unanswered read, which must not read as "no Vault here".
    if (isNotAContractAnswer(err)) return { found: false }
    throw err
  }
  if (!vaultLevelOwner || vaultLevelOwner.toLowerCase() !== expected) {
    return { found: false }
  }
  return { found: true, vaultAddress: candidate }
}

export type IsAgentInVaultArgs = {
  client: VaultReadClient
  vaultAddress: Address
  registry: Address
  agentId: bigint
}

export async function isAgentInVault(
  args: IsAgentInVaultArgs,
): Promise<{ inVault: boolean; ownerAddress?: Address }> {
  const owner = await args.client.readContract({
    address: getAddress(args.vaultAddress),
    abi: VAULT_ABI,
    functionName: 'agentOwner',
    args: [getAddress(args.registry), args.agentId],
  }) as Address
  if (!owner || owner.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { inVault: false }
  }
  return { inVault: true, ownerAddress: getAddress(owner) }
}

export async function confirmAgentInVault(
  args: IsAgentInVaultArgs & { pacing?: VaultCheckPacing },
): Promise<{ inVault: true; ownerAddress: Address }> {
  try {
    return await pacedConfirm(
      'The deposit',
      async () => {
        const status = await isAgentInVault(args)
        if (status.inVault && status.ownerAddress) {
          return { done: true, value: { inVault: true as const, ownerAddress: status.ownerAddress } }
        }
        return { done: false, observed: 'vault reports no owner yet' }
      },
      pacingOptions(args.pacing),
    )
  } catch (err: unknown) {
    if (!(err instanceof PacedTimeoutError)) throw err
    throw new Error(
      `Vault ${getAddress(args.vaultAddress)} does not hold agent token #${args.agentId.toString()} for registry ${getAddress(args.registry)} after waiting for new blocks. The deposit transaction may have been re-orged or applied to the wrong vault. Re-run the switch.`,
    )
  }
}

export type ConfirmAgentWithdrawnArgs = IsAgentInVaultArgs & {
  recipient: Address
}

export async function confirmAgentWithdrawnFromVault(
  args: ConfirmAgentWithdrawnArgs & { pacing?: VaultCheckPacing },
): Promise<{ inVault: false; ownerAddress: Address }> {
  const recipient = getAddress(args.recipient)
  let lastObserved: string | undefined
  try {
    return await pacedConfirm(
      'The withdrawal',
      async () => {
        const status = await isAgentInVault(args)
        const tokenOwner = await args.client.readContract({
          address: getAddress(args.registry),
          abi: ERC721_OWNER_OF_ABI,
          functionName: 'ownerOf',
          args: [args.agentId],
        }) as Address
        const ownerAddress = getAddress(tokenOwner)
        lastObserved = status.inVault
          ? `vault owner ${status.ownerAddress ?? 'unknown'}, token owner ${ownerAddress}`
          : `token owner ${ownerAddress}`
        if (!status.inVault && ownerAddress.toLowerCase() === recipient.toLowerCase()) {
          return { done: true, value: { inVault: false as const, ownerAddress } }
        }
        return { done: false, observed: lastObserved }
      },
      pacingOptions(args.pacing),
    )
  } catch (err: unknown) {
    if (!(err instanceof PacedTimeoutError)) throw err
    throw new Error(
      `Vault ${getAddress(args.vaultAddress)} did not release agent token #${args.agentId.toString()} to ${recipient} after waiting for new blocks. Last observed: ${lastObserved ?? 'unknown'}.`,
    )
  }
}

export type ReadMetadataOperatorsArgs = {
  client: VaultReadClient
  vaultAddress: Address
  registry: Address
  agentId: bigint
  candidates: readonly Address[]
}

export async function readMetadataOperators(
  args: ReadMetadataOperatorsArgs,
): Promise<Record<Address, boolean>> {
  const out: Record<Address, boolean> = {}
  for (const candidate of args.candidates) {
    // A failed read is an error, never "not approved": treating it as a revocation
    // would make a verification report one that did not happen.
    const approved = await args.client.readContract({
      address: getAddress(args.vaultAddress),
      abi: VAULT_ABI,
      functionName: 'metadataOperators',
      args: [getAddress(args.registry), args.agentId, getAddress(candidate)],
    }) as boolean
    out[candidate] = Boolean(approved)
  }
  return out
}

export function isNotAContractAnswer(err: unknown): boolean {
  return isChainAnswer(err)
}
