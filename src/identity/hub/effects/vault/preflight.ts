import { getAddress, type Address, type PublicClient } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import { readOperatorVaultAddressField } from '../../../identityCompat.js'
import { createErc8004PublicClient, type Erc8004RegistryConfig } from '../../../registry/erc8004.js'
import { isAgentInVault, resolveConfiguredOperatorVaultAddress } from '../../../registry/operatorVault.js'
import { readCustodyMode } from '../../model/custody.js'

export class OperatorVaultUnavailableError extends Error {
  constructor(chainId: number) {
    super(`Operator delegation vault is not deployed for chainId ${chainId}. Switching custody mode is unavailable until a deployment is recorded.`)
    this.name = 'OperatorVaultUnavailableError'
  }
}

export class TokenInVaultError extends Error {
  constructor(public vaultAddress: Address) {
    super('Token is in the operator delegation vault. Withdraw it first to prepare a transfer.')
    this.name = 'TokenInVaultError'
  }
}

export async function assertTokenNotInVault(args: {
  identity: EthagentIdentity
  registry: Erc8004RegistryConfig
  operatorVaults?: Readonly<Record<string, string>>
  client?: Pick<PublicClient, 'readContract'>
}): Promise<void> {
  if (!args.identity.agentId) return
  const vaultAddress = vaultAddressForTransferPreflight(args.identity, args.operatorVaults)
  if (!vaultAddress) return
  const client = args.client ?? createErc8004PublicClient(args.registry)
  const status = await isAgentInVault({
    client,
    vaultAddress,
    registry: getAddress(args.registry.identityRegistryAddress),
    agentId: BigInt(args.identity.agentId),
  })
  if (status.inVault) throw new TokenInVaultError(vaultAddress)
}

function vaultAddressForTransferPreflight(
  identity: EthagentIdentity,
  operatorVaults?: Readonly<Record<string, string>>,
): Address | undefined {
  const identityVault = readOperatorVaultAddressField(identity.state as Record<string, unknown> | undefined)
  if (identityVault) return getAddress(identityVault)
  if (readCustodyMode(identity.state as Record<string, unknown> | undefined) !== 'advanced') return undefined
  if (!identity.chainId) return undefined
  return resolveConfiguredOperatorVaultAddress(operatorVaults, identity.chainId)
}
