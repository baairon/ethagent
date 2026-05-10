export type {
  DiscoverOptions,
  EnsAgentTokenReference,
  EnsNameDiscoveryResult,
  EnsValidation,
} from './ensLookup/types.js'
export type { EncodedEnsRecordTransaction } from './ensLookup/records.js'
export {
  isEthDomain,
  normalizeEthDomain,
  sanitizeSubdomainPrefix,
  splitSubdomainName,
} from './ensLookup/names.js'
export { createMainnetClient } from './ensLookup/client.js'
export { resolveEnsAddress, readEthagentTextRecords, readResolverAddress } from './ensLookup/resolve.js'
export { parseAgentTokenReference } from './ensLookup/tokenReference.js'
export { discoverOwnedEnsNameDetails, discoverOwnedEnsNames } from './ensLookup/discovery.js'
export { validateAgentEnsLink } from './ensLookup/validation.js'
export { encodeSetEthagentTextRecords } from './ensLookup/records.js'
