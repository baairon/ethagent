import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'

export type IdentityHubResult =
  | { kind: 'token'; identity: EthagentIdentity }
  | { kind: 'updated'; config: EthagentConfig; message: string }
  | { kind: 'skip' }
  | { kind: 'cancel' }

export type IdentityHubInitialAction = 'create' | 'load' | 'settings' | 'save-snapshot' | 'save-prompt'

export type IdentityHubProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  initialAction?: IdentityHubInitialAction
  onComplete: (result: IdentityHubResult) => void
  onConfigChange?: (config: EthagentConfig) => void
}
