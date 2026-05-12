import type { EthagentConfig, EthagentIdentity, SelectableNetwork } from '../../../../storage/config.js'
import { supportedErc8004ChainForId } from '../../../registry/erc8004.js'
import { resolveSelectedNetwork } from '../../../registry/registryConfig.js'

const NETWORK_LABELS: Record<SelectableNetwork, string> = {
  mainnet: 'ethereum mainnet',
  base:    'base',
}

export function networkLabel(network: SelectableNetwork): string {
  return NETWORK_LABELS[network]
}

const NETWORK_SUBTITLES: Record<SelectableNetwork, string> = {
  mainnet: 'Best for high-value identities and highest security',
  base:    'Best for lower-cost setup and routine updates',
}

export function networkSubtitle(network: SelectableNetwork): string {
  return NETWORK_SUBTITLES[network]
}

export function chainSummaryRow(config?: EthagentConfig, identity?: EthagentIdentity): {
  label: string
  value: string
  tone: 'ok' | 'dim'
} {
  const network = resolveSelectedNetwork(config)
  const fromIdentity = identity?.chainId ? supportedErc8004ChainForId(identity.chainId)?.name.toLowerCase() : undefined
  const value = fromIdentity ?? networkLabel(network)
  return { label: 'chain', value, tone: identity?.chainId ? 'ok' : 'dim' }
}
