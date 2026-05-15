import { toChecksumAddress } from '../crypto/eth.js'
import { normalizeContinuitySnapshotToken, type ContinuitySnapshotToken } from './snapshotToken.js'

const CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES = [
  'Save or Restore Identity Files',
  'Action: encrypt or decrypt local identity files',
  'Private: SOUL.md, MEMORY.md, skills',
  'Public: public skills and profile',
  'Safety: no transaction, spending, or approvals',
  'Version: 2',
] as const

export function createContinuitySnapshotChallenge(ownerAddress: string): string {
  const checksum = toChecksumAddress(ownerAddress)
  return [
    CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES[0],
    `Owner: ${checksum}`,
    ...CONTINUITY_SNAPSHOT_CHALLENGE_MESSAGES.slice(1),
  ].join('\n')
}

export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_LEGACY = 'Prepare Transfer Restore Snapshot'
export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_SENDER = 'Prepare Transfer Snapshot · Sender Restore Slot'
export const TRANSFER_SNAPSHOT_CHALLENGE_HEADER_RECEIVER = 'Prepare Transfer Snapshot · Receiver Restore Slot'

export function createTransferContinuitySnapshotChallenge(args: {
  token: ContinuitySnapshotToken
  ownerAddress: string
  targetAddress: string
  role?: 'sender' | 'receiver'
}): string {
  const token = normalizeContinuitySnapshotToken(args.token)
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const targetAddress = toChecksumAddress(args.targetAddress)
  const header = args.role === 'sender'
    ? TRANSFER_SNAPSHOT_CHALLENGE_HEADER_SENDER
    : args.role === 'receiver'
      ? TRANSFER_SNAPSHOT_CHALLENGE_HEADER_RECEIVER
      : TRANSFER_SNAPSHOT_CHALLENGE_HEADER_LEGACY
  return [
    header,
    `ERC-8004 Chain ID: ${token.chainId}`,
    `ERC-8004 Registry: ${token.identityRegistryAddress}`,
    `ERC-8004 Token ID: ${token.agentId}`,
    `Sender Owner: ${ownerAddress}`,
    `Receiver Owner: ${targetAddress}`,
    'Action: encrypt or decrypt local identity files for this token transfer',
    'Private: SOUL.md, MEMORY.md, skills',
    'Public: public skills and profile',
    'Safety: no transaction, spending, or approvals',
    'Version: 2',
  ].join('\n')
}

export type WalletChallengePurpose =
  | 'create-agent'
  | 'update-snapshot'
  | 'update-ens-snapshot'
  | 'clear-ens-snapshot'
  | 'update-profile-snapshot'
  | 'update-operators-snapshot'
  | 'refetch-snapshot'
  | 'operator-proof'
  | 'restore-owner'
  | 'restore-operator'
  | 'transfer-prepare-sender'
  | 'transfer-prepare-receiver'

const WALLET_CHALLENGE_V2_COPY: Record<WalletChallengePurpose, { title: string; action: string }> = {
  'create-agent':              { title: 'Create Agent Snapshot Key',                action: 'Action: encrypt the new agent snapshot for owner restore' },
  'update-snapshot':           { title: 'Save Snapshot Encryption Key',              action: 'Action: encrypt the updated agent snapshot' },
  'update-ens-snapshot':       { title: 'Update ENS in Agent Snapshot',              action: 'Action: encrypt the snapshot with the new ENS name. No onchain ENS records change.' },
  'clear-ens-snapshot':        { title: 'Unlink ENS from Agent',                     action: 'Action: encrypt the snapshot with no ENS name. No onchain ENS records change.' },
  'update-profile-snapshot':   { title: 'Update Public Profile Snapshot Key',        action: 'Action: encrypt the snapshot with the updated profile' },
  'update-operators-snapshot': { title: 'Update Operator Wallets Snapshot Key',      action: 'Action: encrypt the snapshot with the updated operator list' },
  'refetch-snapshot':          { title: 'Refetch Latest Snapshot',                   action: 'Action: decrypt the latest published snapshot' },
  'operator-proof':            { title: 'Authorize Operator Wallet Restore Access',  action: 'Action: prove this operator wallet can decrypt future snapshots' },
  'restore-owner':             { title: 'Restore Agent with Owner Wallet',           action: 'Action: decrypt the snapshot for the owner wallet' },
  'restore-operator':          { title: 'Restore Agent with Operator Wallet',        action: 'Action: decrypt the snapshot for the authorized operator wallet' },
  'transfer-prepare-sender':   { title: 'Prepare Token Transfer (Sender)',           action: 'Action: encrypt the transfer snapshot for the receiver' },
  'transfer-prepare-receiver': { title: 'Receive Token Transfer (Receiver)',         action: 'Action: prepare receiver decryption for the transfer snapshot' },
}

export function createWalletRestoreAccessChallenge(args: {
  token: ContinuitySnapshotToken
  ownerAddress: string
  walletAddress: string
  accessEpoch?: number
  purpose?: WalletChallengePurpose
}): string {
  const token = normalizeContinuitySnapshotToken(args.token)
  const ownerAddress = toChecksumAddress(args.ownerAddress)
  const walletAddress = toChecksumAddress(args.walletAddress)
  if (args.purpose) {
    const copy = WALLET_CHALLENGE_V2_COPY[args.purpose]
    return [
      copy.title,
      `ERC-8004 Chain ID: ${token.chainId}`,
      `ERC-8004 Registry: ${token.identityRegistryAddress}`,
      `ERC-8004 Token ID: ${token.agentId}`,
      `Owner: ${ownerAddress}`,
      `Wallet: ${walletAddress}`,
      `Access Epoch: ${args.accessEpoch ?? 1}`,
      copy.action,
      'Private: SOUL.md, MEMORY.md, skills',
      'Safety: no transaction, spending, or approvals',
      'Version: 3',
    ].join('\n')
  }
  return [
    'Authorize Wallet Restore Access',
    `ERC-8004 Chain ID: ${token.chainId}`,
    `ERC-8004 Registry: ${token.identityRegistryAddress}`,
    `ERC-8004 Token ID: ${token.agentId}`,
    `Owner: ${ownerAddress}`,
    `Wallet: ${walletAddress}`,
    `Access Epoch: ${args.accessEpoch ?? 1}`,
    'Action: create a restore key for encrypted identity snapshots',
    'Private: SOUL.md, MEMORY.md, skills',
    'Safety: no transaction, spending, or approvals',
    'Version: 2',
  ].join('\n')
}
