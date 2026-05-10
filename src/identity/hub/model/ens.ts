import type { EthagentIdentity } from '../../../storage/config.js'
import { readIdentityStateString } from './custody.js'

export type EnsStatusView =
  | { kind: 'none' }
  | { kind: 'linked'; name: string }
  | { kind: 'issue'; name: string; reason: string }

type EnsValidationRecord = {
  ok: boolean
  reason?: string
  resolvedAddress?: string
  checkedAt?: string
}

function readEnsValidation(state: Record<string, unknown> | undefined): EnsValidationRecord | null {
  const raw = state?.ensValidation
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.ok !== 'boolean') return null
  return {
    ok: obj.ok,
    ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}),
    ...(typeof obj.resolvedAddress === 'string' ? { resolvedAddress: obj.resolvedAddress } : {}),
    ...(typeof obj.checkedAt === 'string' ? { checkedAt: obj.checkedAt } : {}),
  }
}

export function selectEnsStatus(identity: EthagentIdentity | undefined | null): EnsStatusView {
  if (!identity) return { kind: 'none' }
  const name = readIdentityStateString(identity.state, 'ensName')
  if (!name) return { kind: 'none' }
  const validation = readEnsValidation(identity.state)
  if (validation?.ok) return { kind: 'linked', name }
  return { kind: 'issue', name, reason: validation?.reason ?? 'not yet verified' }
}

export function ensValidationReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'no-owner':           return 'Name does not exist on ENS'
    case 'no-resolver':        return 'Name has no resolver set'
    case 'address-mismatch':   return 'ENS name is not resolving to the expected wallet'
    case 'lookup-failed':      return 'Could not reach Ethereum mainnet'
    case 'token-owner-mismatch': return 'Token not held by owner wallet'
    case 'token-owner-lookup-failed': return 'Could not verify ERC-8004 token owner'
    case undefined:            return 'Not yet verified'
    default:                   return reason
  }
}
