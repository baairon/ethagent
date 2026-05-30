import type { Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import type { Step } from '../../reducer.js'

export type IdentityCompletionSource = 'create' | 'restore' | 'update'

export type EffectCallbacks = {
  onStep: (step: Step) => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onIdentityComplete: (identity: EthagentIdentity, message: string, source?: IdentityCompletionSource) => Promise<void>
  onRestoreProgress?: (progress: RestoreProgress | null) => void
  onTokenTransferProgress?: (progress: TokenTransferProgress | null) => void
}

export type RestoreProgress = {
  phase: 'decrypting' | 'writing' | 'finishing'
  label: string
}

export type TokenTransferProgress = {
  phase: 'sender-sign' | 'target-sign' | 'pinning' | 'sender-transaction' | 'confirming'
  walletRole: 'sender' | 'receiver' | 'none'
  title: string
  detail: string
  label: string
  expectedAddress?: Address
  walletAction?: string
}

