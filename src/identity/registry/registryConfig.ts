import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../../storage/config.js'
import {
  chainIdForNetwork,
  DEFAULT_ERC8004_CHAIN_ID,
  DEFAULT_ETHEREUM_RPC_URL,
  DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
  MissingRegistryAddressError,
  networkForChainId,
  normalizeErc8004RegistryConfig,
  supportedErc8004ChainForId,
  type Erc8004RegistryConfig,
} from './erc8004.js'

export type RegistryResolution = {
  config: Erc8004RegistryConfig | null
  network: SelectableNetwork
  chainId: number
  needsRegistryAddress: boolean
  defaultRpcUrl: string
}

export function resolveSelectedNetwork(config?: EthagentConfig): SelectableNetwork {
  if (config?.selectedNetwork) return config.selectedNetwork
  if (config?.erc8004?.chainId) {
    const inferred = networkForChainId(config.erc8004.chainId)
    if (inferred) return inferred
  }
  return 'mainnet'
}

export function registryConfigFromConfig(config?: EthagentConfig): RegistryResolution {
  const network = resolveSelectedNetwork(config)
  const chainId = chainIdForNetwork(network)
  const chain = supportedErc8004ChainForId(chainId)
  const overrideMatchesChain = config?.erc8004?.chainId === chainId
  const defaultRpcUrl = chain?.rpcUrl ?? (chainId === DEFAULT_ERC8004_CHAIN_ID ? DEFAULT_ETHEREUM_RPC_URL : '')

  const inputAddress = overrideMatchesChain ? config?.erc8004?.identityRegistryAddress : undefined
  const inputRpc = overrideMatchesChain ? config?.erc8004?.rpcUrl : undefined
  const inputFromBlock = overrideMatchesChain ? config?.erc8004?.fromBlock : undefined

  try {
    const resolved = normalizeErc8004RegistryConfig({
      chainId,
      rpcUrl: inputRpc ?? process.env.ETHAGENT_RPC_URL,
      identityRegistryAddress: inputAddress ?? chain?.identityRegistryAddress
        ?? (chainId === DEFAULT_ERC8004_CHAIN_ID ? DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS : undefined),
      fromBlock: inputFromBlock,
    })
    return {
      config: resolved,
      network,
      chainId,
      needsRegistryAddress: false,
      defaultRpcUrl,
    }
  } catch (err) {
    if (err instanceof MissingRegistryAddressError) {
      return {
        config: null,
        network,
        chainId,
        needsRegistryAddress: true,
        defaultRpcUrl,
      }
    }
    throw err
  }
}

// Resolve the registry an existing identity should operate against: prefer the
// identity's own chain + registry address (filling in a default RPC when it has
// none), otherwise fall back to the config-derived registry. Pure function of
// (identity, config) so both the TUI controller and headless commands share it.
export function resolveRegistryForIdentity(
  identity: Pick<EthagentIdentity, 'chainId' | 'identityRegistryAddress' | 'rpcUrl'>,
  config?: EthagentConfig,
): Erc8004RegistryConfig | null {
  const resolution = registryConfigFromConfig(config)
  if (identity.chainId && identity.identityRegistryAddress) {
    return {
      chainId: identity.chainId,
      rpcUrl: identity.rpcUrl ?? resolution.defaultRpcUrl,
      identityRegistryAddress: identity.identityRegistryAddress as `0x${string}`,
    }
  }
  return resolution.config
}
