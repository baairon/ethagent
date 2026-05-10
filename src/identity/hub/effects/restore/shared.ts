import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
  type ContinuitySnapshotEnvelope,
  type TransferContinuitySnapshotEnvelope,
} from '../../../continuity/envelope.js'
import { catFromIpfs } from '../../../storage/ipfs.js'
import type { Erc8004AgentCandidate } from '../../../registry/erc8004.js'
import { writePublicSkillsFile } from '../../../continuity/storage.js'
import { normalizeApprovedOperatorWallets } from '../../operatorWallets.js'

export type BackupMetadata = NonNullable<EthagentIdentity['backup']>

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'AbortError'
}

export function requesterAddressFromHandle(handle: string): Address | undefined {
  return isAddress(handle, { strict: false }) ? getAddress(handle) : undefined
}

export function isTransferContinuitySnapshot(
  envelope: ContinuitySnapshotEnvelope,
): envelope is TransferContinuitySnapshotEnvelope {
  return (envelope as TransferContinuitySnapshotEnvelope).crypto?.decryptsWith === 'transfer-signature-slot'
    && typeof (envelope as TransferContinuitySnapshotEnvelope).targetAddress === 'string'
    && !!(envelope as TransferContinuitySnapshotEnvelope).slots
}

export function restoreTransferSlotForRequester(
  envelope: TransferContinuitySnapshotEnvelope,
  requesterAddress: Address,
): TransferContinuitySnapshotEnvelope['slots']['owner'] | null {
  if (requesterAddress.toLowerCase() === getAddress(envelope.ownerAddress).toLowerCase()) {
    return envelope.slots.owner
  }
  if (requesterAddress.toLowerCase() === getAddress(envelope.targetAddress).toLowerCase()) {
    return envelope.slots.target
  }
  return null
}

export function isAuthorizedOperatorAddress(candidate: Erc8004AgentCandidate, address: Address): boolean {
  const target = address.toLowerCase()
  if (candidate.operators?.activeOperatorAddress?.toLowerCase() === target) return true
  return candidate.operators?.approvedOperatorWallets.some(record => record.address.toLowerCase() === target) ?? false
}

export function ownerCandidateAddresses(candidate: Erc8004AgentCandidate): Address[] {
  const out: Address[] = []
  const seen = new Set<string>()
  const push = (addr: Address | undefined): void => {
    if (!addr) return
    const lower = addr.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    out.push(getAddress(addr))
  }
  push(candidate.ownerAddress)
  return out
}

export function operatorStateFromCandidate(candidate: Erc8004AgentCandidate): Record<string, unknown> {
  const operators = candidate.operators
  if (!operators) return {}
  return {
    approvedOperatorWallets: normalizeApprovedOperatorWallets(operators.approvedOperatorWallets),
    ...(operators.activeOperatorAddress ? { activeOperatorAddress: operators.activeOperatorAddress } : {}),
    ...(operators.ownerAddress ? { ownerAddress: operators.ownerAddress } : {}),
    ...(operators.ensName ? { ensName: operators.ensName } : {}),
    ...(operators.restoreAccessEpoch ? { restoreAccessEpoch: operators.restoreAccessEpoch } : {}),
    ...(operators.ownerRestoreAccessKey ? { ownerRestoreAccessKey: operators.ownerRestoreAccessKey } : {}),
  }
}

export async function restorePublishedPublicSkills(
  identity: EthagentIdentity,
  apiUrl: string,
  cid: string | undefined,
): Promise<boolean> {
  if (!cid) return false
  try {
    const raw = await catFromIpfs(apiUrl, cid)
    await writePublicSkillsFile(identity, new TextDecoder().decode(raw))
    return true
  } catch {
    return false
  }
}
