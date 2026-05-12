import { getAddress, type Address } from 'viem'
import {
  ContinuitySnapshotOwnerMismatchError,
  ContinuitySnapshotRestoreSlotMissingError,
  findRestorableAddressForSnapshot,
  isWalletContinuitySnapshotEnvelope,
  walletContinuitySnapshotSlotForAddress,
  type ContinuitySnapshotEnvelope,
} from '../../continuity/envelope.js'
import { assertAgentStateBackupOwner } from '../../crypto/backupEnvelope.js'
import type { Erc8004AgentCandidate } from '../../registry/erc8004.js'
import { requestBrowserWalletAccount, type WalletPurpose } from '../../wallet/browserWallet.js'
import type { Step } from '../identityHubReducer.js'
import type { EffectCallbacks } from '../shared/effects/types.js'
import { isContinuitySnapshotEnvelope, parseRestorableEnvelope } from './envelopes.js'
import {
  isAuthorizedOperatorAddress,
  isTransferContinuitySnapshot,
  ownerCandidateAddresses,
  requesterAddressFromHandle,
  restoreTransferSlotForRequester,
} from './helpers.js'

export async function runRestoreConnectWallet(
  step: Extract<Step, { kind: 'restore-wallet' }>,
  callbacks: EffectCallbacks,
): Promise<void> {
  const wallet = await requestBrowserWalletAccount({
    onReady: callbacks.onWalletReady,
    purpose: 'connect-operator-wallet',
  })
  callbacks.onStep({ kind: 'restore-network', ownerHandle: wallet.account, purpose: step.purpose })
}

export function restoreSignatureRequestForStep(
  step: Extract<Step, { kind: 'restore-authorizing' }>,
): {
  expectedAccount: Address
  message: string
  purpose: WalletPurpose
  role: 'owner-wallet' | 'operator-wallet'
} {
  if (isContinuitySnapshotEnvelope(step.envelope)) {
    const requesterAddress = step.requesterAddress ? requesterAddressFromHandle(step.requesterAddress) : undefined
    if (requesterAddress && isWalletContinuitySnapshotEnvelope(step.envelope)) {
      const slot = walletContinuitySnapshotSlotForAddress(step.envelope, requesterAddress)
      if (slot) {
        const ownerAddress = getAddress(step.envelope.ownerAddress)
        const requesterIsOwner = requesterAddress.toLowerCase() === ownerAddress.toLowerCase()
        return {
          expectedAccount: requesterAddress,
          message: slot.challenge,
          purpose: requesterIsOwner ? 'restore-owner-wallet' : 'restore-operator-wallet',
          role: requesterIsOwner ? 'owner-wallet' : 'operator-wallet',
        }
      }
      if (isAuthorizedOperatorAddress(step.candidate, requesterAddress)) {
        throw new Error('Restore Slot Missing: re-save this agent once with the owner wallet.')
      }
    }
    if (requesterAddress && isTransferContinuitySnapshot(step.envelope)) {
      const transferSlot = restoreTransferSlotForRequester(step.envelope, requesterAddress)
      if (transferSlot) {
        const ownerAddress = getAddress(step.envelope.ownerAddress)
        const requesterIsOwner = requesterAddress.toLowerCase() === ownerAddress.toLowerCase()
        return {
          expectedAccount: requesterAddress,
          message: transferSlot.challenge,
          purpose: requesterIsOwner ? 'restore-owner-wallet' : 'restore-operator-wallet',
          role: requesterIsOwner ? 'owner-wallet' : 'operator-wallet',
        }
      }
    }
    const ownerCandidates = ownerCandidateAddresses(step.candidate)
    if (requesterAddress
      && !ownerCandidates.some(addr => addr.toLowerCase() === requesterAddress.toLowerCase())
      && isAuthorizedOperatorAddress(step.candidate, requesterAddress)) {
      throw new Error('Restore Slot Missing: re-save this agent once with the owner wallet.')
    }
    if (isWalletContinuitySnapshotEnvelope(step.envelope)) {
      for (const candidateAddress of ownerCandidates) {
        const slot = walletContinuitySnapshotSlotForAddress(step.envelope, candidateAddress)
        if (slot) {
          return {
            expectedAccount: candidateAddress,
            message: slot.challenge,
            purpose: 'restore-owner-wallet',
            role: 'owner-wallet',
          }
        }
      }
      throw new Error('Restore Slot Missing: re-save this agent once with the owner wallet.')
    }
    return {
      expectedAccount: ownerCandidates[0] ?? getAddress(step.candidate.ownerAddress),
      message: step.envelope.challenge,
      purpose: 'restore-owner-wallet',
      role: 'owner-wallet',
    }
  }
  return {
    expectedAccount: getAddress(step.candidate.ownerAddress),
    message: step.envelope.challenge,
    purpose: 'restore-owner-wallet',
    role: 'owner-wallet',
  }
}

export function restoreMessageForWallet(envelope: ContinuitySnapshotEnvelope, address: Address): string {
  if (isWalletContinuitySnapshotEnvelope(envelope)) {
    const slot = walletContinuitySnapshotSlotForAddress(envelope, address)
    if (!slot) throw new Error('Restore Slot Missing: re-save this agent once with the owner wallet.')
    return slot.challenge
  }
  if (isTransferContinuitySnapshot(envelope)) {
    const slot = restoreTransferSlotForRequester(envelope, address)
    if (!slot) throw new Error('Restore Slot Missing: re-save this agent once with the owner wallet.')
    return slot.challenge
  }
  return envelope.challenge
}

export function assertCandidateCanReadEnvelope(
  candidate: Erc8004AgentCandidate,
  requesterHandle: string | undefined,
  envelope: ReturnType<typeof parseRestorableEnvelope>,
): void {
  const requester = requesterHandle ? requesterAddressFromHandle(requesterHandle) : undefined
  const candidateAddresses: string[] = []
  const seen = new Set<string>()
  const add = (addr: string | undefined): void => {
    if (!addr) return
    const lower = addr.toLowerCase()
    if (seen.has(lower)) return
    seen.add(lower)
    candidateAddresses.push(addr)
  }
  add(candidate.ownerAddress)
  add(requester)
  if (candidate.operators?.activeOperatorAddress) add(candidate.operators.activeOperatorAddress)
  for (const record of candidate.operators?.approvedOperatorWallets ?? []) add(record.address)

  if (isContinuitySnapshotEnvelope(envelope)) {
    if (findRestorableAddressForSnapshot(envelope, candidateAddresses)) return
    if (isWalletContinuitySnapshotEnvelope(envelope)) {
      throw new ContinuitySnapshotRestoreSlotMissingError(requester ?? candidate.ownerAddress)
    }
    const snapshotOwner = (envelope as { ownerAddress?: string }).ownerAddress ?? ''
    throw new ContinuitySnapshotOwnerMismatchError(snapshotOwner, requester ?? candidate.ownerAddress)
  }
  for (const addr of candidateAddresses) {
    try {
      assertAgentStateBackupOwner(envelope, addr)
      return
    } catch {
    }
  }
  assertAgentStateBackupOwner(envelope, candidate.ownerAddress)
}
