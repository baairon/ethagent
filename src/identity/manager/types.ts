import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'

export type IdentityManagerResult =
  | { kind: 'token'; identity: EthagentIdentity }
  | { kind: 'updated'; config: EthagentConfig; message: string }
  | { kind: 'cancel' }

export type IdentityManagerInitialAction = 'create' | 'load' | 'settings' | 'save-snapshot' | 'save-prompt'

export type IdentityManagerProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  initialAction?: IdentityManagerInitialAction
  onComplete: (result: IdentityManagerResult) => void
  onConfigChange?: (config: EthagentConfig) => void
}
