import type { EthagentConfig } from '../../../storage/config.js'
import { saveConfig } from '../../../storage/config.js'
import { normalizeErc8004RegistryConfig } from '../../registry/erc8004.js'
import { registryConfigFromConfig } from '../../registry/registryConfig.js'
import type { Step } from '../identityHubReducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'

export async function runRestoreRegistrySubmit(
  value: string,
  step: Extract<Step, { kind: 'restore-registry' }>,
  config: EthagentConfig | undefined,
  onConfigChange: ((config: EthagentConfig) => void) | undefined,
  callbacks: EffectCallbacks,
): Promise<void> {
  const resolution = registryConfigFromConfig(config)
  const registry = normalizeErc8004RegistryConfig({
    chainId: resolution.chainId,
    rpcUrl: resolution.config?.rpcUrl ?? resolution.defaultRpcUrl,
    identityRegistryAddress: value.trim(),
  })
  if (config && onConfigChange) {
    const next: EthagentConfig = {
      ...config,
      erc8004: {
        chainId: registry.chainId,
        rpcUrl: registry.rpcUrl,
        identityRegistryAddress: registry.identityRegistryAddress,
      },
    }
    await saveConfig(next)
    onConfigChange(next)
  }
  callbacks.onStep({ kind: 'restore-discovering', ownerHandle: step.ownerHandle, registry, purpose: step.purpose })
}
