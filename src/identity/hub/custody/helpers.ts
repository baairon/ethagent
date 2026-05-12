import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { buildSeedConfigForIdentity } from '../../../storage/config.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import { supportedErc8004ChainForId, type Erc8004RegistryConfig } from '../../registry/erc8004.js'

export function chainLabel(chainId: number): string {
  return supportedErc8004ChainForId(chainId)?.name ?? `chain ${chainId}`
}

export function humanOwnerAddress(identity: EthagentIdentity): `0x${string}` {
  const stateOwnerAddress = readOwnerAddressField(identity.state as Record<string, unknown> | undefined)
  if (stateOwnerAddress && /^0x[a-fA-F0-9]{40}$/.test(stateOwnerAddress)) {
    return stateOwnerAddress as `0x${string}`
  }
  return (identity.ownerAddress ?? identity.address) as `0x${string}`
}

export function buildSeedConfigFromStep(identity: EthagentIdentity, registry: Erc8004RegistryConfig): EthagentConfig {
  return buildSeedConfigForIdentity({
    identity,
    chainId: registry.chainId,
    rpcUrl: registry.rpcUrl,
    identityRegistryAddress: registry.identityRegistryAddress,
  })
}
