export type AgentReconciliation = {
  token: 'linked' | 'unlinked' | 'unknown' | 'no-agent'
  tokenDetail?: string
  tokenAgentId?: string
  onChainOwner?: string
  custody: 'simple' | 'advanced' | 'withdrawn' | 'mid-flow-uri-pending' | 'unknown'
  agentUri: 'in-sync' | 'chain-newer' | 'local-newer' | 'unknown'
  // 'unrecognized': the address has code, but not any known Vault build.
  vault: 'confirmed' | 'missing' | 'unrecognized' | 'unset' | 'unknown'
  vaultBuild?: { id: string; label: string; hasHeldAgent: boolean }
  workingTree: 'clean' | 'dirty' | 'unknown'
  rpc: 'reachable' | 'failing'
  driftCount: number
  lastCheckedAt: string
}
