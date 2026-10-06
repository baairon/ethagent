import { getAddress, isAddress, type Address } from 'viem'
import type { EthagentIdentity } from '../../../storage/config.js'
import { createWalletRestoreAccessChallenge, createWalletRestoreAccessKey } from '../../continuity/envelope.js'
import { readOwnerAddressField } from '../../identityCompat.js'
import type { Erc8004RegistryConfig } from '../../registry/erc8004.js'
import type { ProfileUpdates } from '../reducer.js'
import {
  normalizeApprovedOperatorWallets,
  removeApprovedOperatorWallet,
  upsertApprovedOperatorWallet,
  type ApprovedOperatorWalletRecord,
} from './operatorWallets.js'

// What adding, removing, or activating an operator reads from local state. Every
// operator change starts a new restore-access epoch, so the change is signed for
// epoch + 1, as the manager's Operator Wallets screen does.
export type OperatorAccessContext = {
  ownerAddress: Address
  records: ApprovedOperatorWalletRecord[]
  activeOperatorAddress: Address | undefined
  nextEpoch: number
  token: { chainId: number; identityRegistryAddress: Address; agentId: string }
}

export function operatorAccessContext(identity: EthagentIdentity, registry: Erc8004RegistryConfig): OperatorAccessContext {
  const state = (identity.state ?? {}) as Record<string, unknown>
  const ownerRaw = readOwnerAddressField(state)
  if (!ownerRaw || !isAddress(ownerRaw, { strict: false })) {
    throw new Error('Advanced custody needs an owner wallet before managing operator wallets.')
  }
  if (!identity.agentId) throw new Error('The agent token ID is required before authorizing a wallet.')
  const epochRaw = state.restoreAccessEpoch
  const epoch = typeof epochRaw === 'number' && Number.isSafeInteger(epochRaw) && epochRaw >= 0 ? epochRaw : 0
  const activeRaw = state.activeOperatorAddress
  return {
    ownerAddress: getAddress(ownerRaw),
    records: normalizeApprovedOperatorWallets(state.approvedOperatorWallets),
    activeOperatorAddress: typeof activeRaw === 'string' && isAddress(activeRaw, { strict: false }) ? getAddress(activeRaw) : undefined,
    nextEpoch: epoch + 1,
    token: { chainId: registry.chainId, identityRegistryAddress: registry.identityRegistryAddress, agentId: identity.agentId },
  }
}

// The challenge an operator signs to prove it holds its wallet and to derive its
// restore-access key for the next epoch.
export function operatorProofChallenge(ctx: OperatorAccessContext, operator: Address): string {
  return createWalletRestoreAccessChallenge({
    token: ctx.token,
    ownerAddress: ctx.ownerAddress,
    walletAddress: operator,
    accessEpoch: ctx.nextEpoch,
    purpose: 'restore-operator',
  })
}

export function operatorRecordFromProof(
  ctx: OperatorAccessContext,
  proof: { account: Address; message: string; signature: string },
): ApprovedOperatorWalletRecord {
  if (proof.account.toLowerCase() === ctx.ownerAddress.toLowerCase()) {
    throw new Error('The operator wallet must differ from the owner wallet.')
  }
  const restoreAccessKey = createWalletRestoreAccessKey({
    token: ctx.token,
    ownerAddress: ctx.ownerAddress,
    walletAddress: proof.account,
    walletSignature: proof.signature,
    accessEpoch: ctx.nextEpoch,
    createdAt: new Date().toISOString(),
    purpose: 'restore-operator',
  })
  return {
    address: getAddress(proof.account),
    challenge: proof.message,
    verifiedAt: restoreAccessKey.createdAt,
    restoreAccessKey,
  }
}

function operatorUpdates(ctx: OperatorAccessContext, records: ApprovedOperatorWalletRecord[], active: Address | '' | undefined): ProfileUpdates {
  return {
    custodyMode: 'advanced',
    ownerAddress: ctx.ownerAddress,
    approvedOperatorWallets: records,
    restoreAccessEpoch: ctx.nextEpoch,
    ...(active !== undefined ? { activeOperatorAddress: active } : {}),
  }
}

// The new operator becomes active when none is.
export function addOperatorUpdates(ctx: OperatorAccessContext, record: ApprovedOperatorWalletRecord): ProfileUpdates {
  return operatorUpdates(ctx, upsertApprovedOperatorWallet(ctx.records, record), ctx.activeOperatorAddress ?? record.address)
}

// Removing the active operator leaves none active.
export function removeOperatorUpdates(ctx: OperatorAccessContext, operator: Address): ProfileUpdates {
  if (!ctx.records.some(record => record.address.toLowerCase() === operator.toLowerCase())) {
    throw new Error(`${operator} is not an approved operator.`)
  }
  const records = removeApprovedOperatorWallet(ctx.records, operator)
  const active = ctx.activeOperatorAddress?.toLowerCase() === operator.toLowerCase() ? '' : ctx.activeOperatorAddress
  return operatorUpdates(ctx, records, active)
}

export function activateOperatorUpdates(ctx: OperatorAccessContext, operator: Address): ProfileUpdates {
  const record = ctx.records.find(item => item.address.toLowerCase() === operator.toLowerCase())
  if (!record) throw new Error(`${operator} is not an approved operator.`)
  return operatorUpdates(ctx, ctx.records, getAddress(record.address))
}
