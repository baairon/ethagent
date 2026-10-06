import { getAddress, type Address } from 'viem'
import { AGENT_TOKEN_RECORD_KEY, type AgentEnsRecords, type AgentRecordDiff } from '../../ens/agentRecords.js'
import type { EnsSetupBlockedPlan } from '../../ens/ensAutomation.js'
import type { CustodyMode } from '../custody/state.js'
import { networkName } from '../shared/model/network.js'

export function abbreviateHexBlobs(input: string): string {
  return input.replace(/0x([0-9a-fA-F]{20,})/g, (_match, hex) => {
    return `0x${hex.slice(0, 8)}…${hex.slice(-8)}`
  })
}

export function abbreviateRecordValue(input: string): string {
  return abbreviateHexBlobs(input).replace(/\bbaf[a-z2-7]{30,}/g, cid => `${cid.slice(0, 10)}…${cid.slice(-6)}`)
}

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
  return {}
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

function chainIdFromInteropAddress(hex: string): number | null {
  const body = hex.replace(/^0x/i, '')
  if (body.length < 10) return null
  const referenceLength = parseInt(body.slice(8, 10), 16)
  if (!Number.isFinite(referenceLength) || referenceLength === 0) return null
  const reference = body.slice(10, 10 + referenceLength * 2)
  const chainId = parseInt(reference, 16)
  return Number.isFinite(chainId) && chainId > 0 ? chainId : null
}

export function recordTokenTarget(key: string, value: string): string | null {
  const ensip25 = /^agent-registration\[(0x[0-9a-fA-F]+)\]\[([^\]]+)\]$/.exec(key)
  if (ensip25) {
    const chainId = chainIdFromInteropAddress(ensip25[1]!)
    return `token #${ensip25[2]}${chainId ? ` on ${networkName(chainId)}` : ''}`
  }
  if (key === AGENT_TOKEN_RECORD_KEY) {
    const reference = /^eip155:(\d+):0x[0-9a-fA-F]{40}:(\S+)$/.exec(value)
    if (reference) return `token #${reference[2]} on ${networkName(Number(reference[1]))}`
  }
  return null
}

export function describeRecordChanges(recordsDiff: AgentRecordDiff[]): string[] {
  const lines: string[] = []
  for (const diff of recordsDiff) {
    if (!diff.changed) continue
    const target = recordTokenTarget(diff.key, diff.next || diff.current)
    const line = target
      ? diff.next ? `Link to ${target}` : `Remove the link to ${target}`
      : diff.next ? `Set ${abbreviateRecordValue(diff.key)}` : `Clear ${abbreviateRecordValue(diff.key)}`
    if (!lines.includes(line)) lines.push(line)
  }
  return lines
}

export function describeCurrentRecords(recordsDiff: AgentRecordDiff[]): string[] {
  const lines: string[] = []
  for (const diff of recordsDiff) {
    if (!diff.current.trim()) continue
    const target = recordTokenTarget(diff.key, diff.current)
    const line = target ? `Remove the link to ${target}` : `Clear ${abbreviateRecordValue(diff.key)}`
    if (!lines.includes(line)) lines.push(line)
  }
  return lines
}

export function manualReasonTitle(reason: EnsSetupBlockedPlan['reason']): string {
  switch (reason) {
    case 'wrapped-parent':
    case 'subdomain-wrapped':
      return 'The NameWrapper owner of this name could not be confirmed.'
    case 'token-owner-mismatch':
      return 'The owner wallet does not hold this agent token.'
    case 'token-owner-lookup-failed':
      return 'The agent token owner could not be confirmed.'
    case 'parent-missing-resolver':
      return 'The parent name needs a resolver first.'
    case 'subdomain-owned-by-other':
      return 'Another wallet controls this subdomain.'
    case 'operator-matches-owner':
      return 'The operator wallet must differ from the owner wallet.'
    case 'root-not-owned':
      return 'This wallet does not manage the parent name.'
    case 'root-owner-mismatch':
      return 'The connected wallet does not manage the parent name.'
    case 'invalid-root':
    case 'invalid-label':
    case 'missing-token-id':
    case 'lookup-failed':
      return 'The name could not be checked.'
  }
}

export function readValidationFromState(state: Record<string, unknown> | undefined): { ok: boolean; reason?: string } | null {
  const raw = state?.ensValidation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok !== 'boolean') return null
  return { ok: obj.ok, ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}) }
}
