import { getAddress } from 'viem'
import type { TokenTransferProgress } from '../shared/effects/types.js'

export function tokenTransferProgressForPhase(
  phase: TokenTransferProgress['phase'],
  ownerAddress: string,
  targetAddress: string,
): TokenTransferProgress {
  const sender = getAddress(ownerAddress)
  const receiver = getAddress(targetAddress)
  switch (phase) {
    case 'sender-sign':
      return {
        phase,
        walletRole: 'sender',
        expectedAddress: sender,
        title: 'Use Sender Wallet',
        detail: 'Sign to save a transfer snapshot.',
        walletAction: 'Sign Snapshot',
        label: 'Sender Wallet: sign to save the transfer snapshot.',
      }
    case 'target-sign':
      return {
        phase,
        walletRole: 'receiver',
        expectedAddress: receiver,
        title: 'Use Receiver Wallet',
        detail: 'Sign so this wallet can restore after it receives the token.',
        walletAction: 'Sign Restore Access',
        label: 'Receiver Wallet: sign once to authorize future restore after the token transfer.',
      }
    case 'sender-transaction':
      return {
        phase,
        walletRole: 'sender',
        expectedAddress: sender,
        title: 'Use Sender Wallet Again',
        detail: 'Publish the transfer snapshot to the ERC-8004 token URI.',
        walletAction: 'Update Token URI',
        label: 'Sender Wallet: sign one ERC-8004 token URI update that points the token at the transfer snapshot.',
      }
    case 'pinning':
      return {
        phase,
        walletRole: 'none',
        title: 'Publishing Snapshot',
        detail: 'Encrypting and pinning the dual-wallet transfer snapshot.',
        label: 'Encrypting and pinning the dual-wallet transfer snapshot.',
      }
    case 'confirming':
      return {
        phase,
        walletRole: 'none',
        title: 'Confirming Token URI Update',
        detail: 'Waiting for the ERC-8004 token URI transaction.',
        label: 'Confirming the ERC-8004 token URI update.',
      }
  }
}
