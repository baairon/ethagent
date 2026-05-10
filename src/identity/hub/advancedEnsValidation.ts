import { getAddress, type Address, type PublicClient } from 'viem'
import { validateAgentEnsLink, type DiscoverOptions, type EnsValidation } from '../ens/ensLookup.js'
import {
  validateErc8004TokenOwner,
  type Erc8004RegistryConfig,
} from '../registry/erc8004.js'

type TokenOwnerReadClient = Pick<PublicClient, 'readContract'>

type AdvancedEnsRelationshipArgs = {
  fullName: string
  ownerAddress: Address
  registry: Erc8004RegistryConfig
  agentId: string | bigint | undefined
  ensOptions?: DiscoverOptions
  tokenPublicClient?: TokenOwnerReadClient
}

export async function validateAdvancedEnsRelationship(
  args: AdvancedEnsRelationshipArgs,
): Promise<EnsValidation> {
  if (args.agentId === undefined || args.agentId === '') {
    return {
      ok: false,
      reason: 'token-owner-lookup-failed',
      detail: 'identity is missing an ERC-8004 token id',
    }
  }
  const agentId = typeof args.agentId === 'bigint' ? args.agentId : BigInt(args.agentId)
  const ownerAddress = getAddress(args.ownerAddress)
  const tokenOwner = await validateErc8004TokenOwner({
    ...args.registry,
    agentId,
    expectedOwner: ownerAddress,
    publicClient: args.tokenPublicClient,
  })
  if (!tokenOwner.ok) {
    return {
      ok: false,
      reason: tokenOwner.reason,
      detail: tokenOwner.detail,
    }
  }
  return validateAgentEnsLink(args.fullName, ownerAddress, args.ensOptions ?? {})
}
