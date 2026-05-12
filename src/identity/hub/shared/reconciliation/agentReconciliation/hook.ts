import { useEffect, useState } from 'react'
import type { EthagentConfig } from '../../../../../storage/config.js'
import { emptyReconciliation, runReconciliation } from './run.js'
import type { AgentReconciliation } from './types.js'

export function useAgentReconciliation(
  config: EthagentConfig | null,
): { reconciliation: AgentReconciliation; refresh: () => void } {
  const [reconciliation, setReconciliation] = useState<AgentReconciliation>(() => ({
    token: 'no-agent',
    custody: 'unknown',
    agentUri: 'unknown',
    vault: 'unset',
    workingTree: 'unknown',
    rpc: 'reachable',
    driftCount: 0,
    lastCheckedAt: new Date(0).toISOString(),
  }))
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!config?.identity || !config.identity.agentId || !config.identity.chainId || !config.identity.identityRegistryAddress) {
      setReconciliation(emptyReconciliation())
      return
    }
    const identity = config.identity
    let cancelled = false
    ;(async () => {
      const result = await runReconciliation(identity, config)
      if (cancelled) return
      setReconciliation(result)
    })()
    return () => { cancelled = true }
  }, [
    config?.identity?.agentId,
    config?.identity?.chainId,
    config?.identity?.address,
    config?.identity?.backup?.agentUri,
    config?.identity?.state,
    config?.erc8004?.operatorVaults,
    refreshKey,
  ])

  return { reconciliation, refresh: () => setRefreshKey(k => k + 1) }
}
