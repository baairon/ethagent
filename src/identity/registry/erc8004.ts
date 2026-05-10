export {
  DEFAULT_ERC8004_CHAIN_ID,
  DEFAULT_ERC8004_IDENTITY_REGISTRY_ADDRESS,
  DEFAULT_ETHEREUM_RPC_URL,
  MissingRegistryAddressError,
  SUPPORTED_ERC8004_CHAINS,
  chainIdForNetwork,
  erc8004ConfigForSupportedChain,
  networkForChainId,
  normalizeErc8004RegistryConfig,
  supportedErc8004ChainForId,
} from './erc8004/chains.js'
export type { SupportedErc8004Chain } from './erc8004/chains.js'
export { createErc8004PublicClient } from './erc8004/client.js'
export {
  AgentTokenIdRequiredError,
  discoverOwnedAgentBackupByTokenId,
  discoverOwnedAgentBackups,
  discoverOwnedAgentBackupsAcrossSupportedNetworks,
} from './erc8004/discovery.js'
export {
  parseEthagentBackupPointer,
  parseEthagentOperatorsPointer,
  parseEthagentPublicDiscoveryPointer,
  withEthagentBackupPointer,
  withEthagentPointers,
} from './erc8004/metadata.js'
export {
  RegisterAgentPreflightError,
  preflightRegisterAgent,
  preflightSetAgentUri,
} from './erc8004/preflight.js'
export type { RegisterAgentPreflight, RegisterAgentPreflightErrorCode } from './erc8004/preflight.js'
export type {
  ApprovedOperatorWalletRecord,
  DiscoverOwnedAgentsAcrossSupportedNetworksArgs,
  DiscoverOwnedAgentsArgs,
  Erc8004AgentCandidate,
  Erc8004RegistryConfig,
  EthagentBackupPointer,
  EthagentOperatorsPointer,
  EthagentPublicDiscoveryPointer,
  EthagentRegistrationPointer,
  EthagentX402Pointer,
} from './erc8004/types.js'
export { cidFromUri, loadAgentRegistration } from './erc8004/uri.js'
export { validateErc8004TokenOwner } from './erc8004/ownership.js'
export type { Erc8004TokenOwnerValidation } from './erc8004/ownership.js'
export {
  encodeRegisterAgent,
  encodeSetAgentUri,
  registeredAgentFromReceipt,
} from './erc8004/transactions.js'
