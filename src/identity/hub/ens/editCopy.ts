import { getAddress, type Address } from 'viem'
import type { AgentEnsRecords, AgentRecordDiff } from '../../ens/agentRecords.js'
import type { EnsRegistryAction, EnsSetupBlockedPlan } from '../../ens/ensAutomation.js'
import type { CustodyMode } from '../custody/state.js'

export type EnsLinkOptions = {
  mode: 'simple' | 'advanced'
  ownerAddress?: Address
  operatorWallet?: Address
}

export function recordsDiffHasChanges(recordsDiff: AgentRecordDiff[]): boolean {
  return recordsDiff.some(diff => diff.changed)
}

export function recordsHaveCurrentValues(recordsDiff: AgentRecordDiff[]): boolean {
  return recordsDiff.some(diff => diff.current.trim())
}

export function emptyAgentEnsRecords(): AgentEnsRecords {
  return { token: '' }
}

export function unlinkEnsLinkOptions(savedCustodyMode: CustodyMode | undefined, savedOwnerAddress: string): EnsLinkOptions {
  if (savedCustodyMode === 'advanced' && /^0x[0-9a-fA-F]{40}$/.test(savedOwnerAddress)) {
    return { mode: 'advanced', ownerAddress: getAddress(savedOwnerAddress as Address) }
  }
  return { mode: 'simple' }
}

export function discoveryErrorMessage(errors: string[]): string {
  return errors.find(Boolean) ?? 'ENS lookup failed'
}

export function modeSwitchHeading(
  currentEnsName: string,
  currentMode: CustodyMode | undefined,
  nextEnsName: string,
  nextMode: 'simple' | 'advanced',
): string {
  if (!currentEnsName && !currentMode) return 'Automation'
  const currentTopology = currentMode === 'advanced' ? 'advanced' : currentMode === 'simple' ? 'simple' : undefined
  const modeChanged = currentTopology !== undefined && currentTopology !== nextMode
  if (modeChanged) return 'Prepare ENS Setup Switch'
  if (currentEnsName !== nextEnsName) return 'Prepare ENS Name Switch'
  return 'Automation'
}

export function setupSwitchNotice(
  currentEnsName: string,
  currentMode: CustodyMode | undefined,
  nextEnsName: string,
  nextMode: 'simple' | 'advanced',
): string | null {
  if (!currentEnsName && !currentMode) return null
  const currentTopology = currentMode === 'advanced' ? 'advanced' : currentMode === 'simple' ? 'simple' : undefined
  if (currentEnsName === nextEnsName && currentTopology === nextMode) return null
  return 'This replaces the saved ENS setup directly. Reset is only for clearing the current link.'
}

export function advancedSubdomainStatusText(action: EnsRegistryAction): string {
  switch (action) {
    case 'create-subdomain':
    case 'create-wrapped-subdomain':
      return 'Subdomain check: the owner wallet can create this agent ENS name during setup.'
    case 'set-resolver':
    case 'set-wrapped-resolver':
      return 'Subdomain check: the owner wallet can prepare this ENS name during setup.'
    case 'none':
      return 'Subdomain check: this ENS name is ready.'
  }
}

export function networkLabelForChainId(chainId: number): string {
  switch (chainId) {
    case 1: return 'Ethereum Mainnet'
    case 8453: return 'Base'
    default: return `Chain ${chainId}`
  }
}

export function manualReasonTitle(reason: EnsSetupBlockedPlan['reason']): string {
  switch (reason) {
    case 'wrapped-parent':
    case 'subdomain-wrapped':
      return 'ENS NameWrapper ownership could not be verified'
    case 'token-record-collision':
      return 'Subdomain already points to another token'
    case 'token-owner-mismatch':
      return 'Owner wallet does not own this ERC-8004 token'
    case 'token-owner-lookup-failed':
      return 'Could not verify ERC-8004 token owner'
    case 'parent-missing-resolver':
      return 'Parent ENS name needs a resolver'
    case 'subdomain-owned-by-other':
      return 'Subdomain is managed by another wallet'
    case 'operator-matches-owner':
      return 'Operator wallet must be separate'
    case 'root-not-owned':
      return 'Parent ENS name is not manageable'
    case 'root-owner-mismatch':
      return 'Connected wallet does not manage the parent ENS name'
    case 'invalid-root':
    case 'invalid-label':
    case 'missing-token-id':
    case 'lookup-failed':
      return 'ENS setup needs attention'
  }
}

export function readValidationFromState(state: Record<string, unknown> | undefined): { ok: boolean; reason?: string } | null {
  const raw = state?.ensValidation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok !== 'boolean') return null
  return { ok: obj.ok, ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}) }
}
