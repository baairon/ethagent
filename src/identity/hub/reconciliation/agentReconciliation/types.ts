import type { RecordsFixPlan } from '../walletSetup.js'

export type AgentReconciliation = {
  token: 'linked' | 'unlinked' | 'unknown' | 'no-agent'
  tokenDetail?: string
  tokenAgentId?: string
  onChainOwner?: string
  custody: 'simple' | 'advanced' | 'withdrawn' | 'mid-flow-uri-pending' | 'unknown'
  agentUri: 'in-sync' | 'chain-newer' | 'local-newer' | 'unknown'
  ensRecords: 'aligned' | 'drift' | 'unset' | 'unknown'
  ensRecordsPlan?: RecordsFixPlan
  vault: 'confirmed' | 'missing' | 'unset' | 'unknown'
  workingTree: 'clean' | 'dirty' | 'unknown'
  rpc: 'reachable' | 'failing'
  driftCount: number
  lastCheckedAt: string
}
