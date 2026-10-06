import type { Address } from 'viem'
import type { EthagentIdentity } from '../../../../storage/config.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import type { Step } from '../../reducer.js'

export type IdentityCompletionSource = 'create' | 'restore' | 'update'

export type EffectCallbacks = {
  signal?: AbortSignal
  onStep: (step: Step) => void
  onWalletReady: (session: BrowserWalletReady | null) => void
  onIdentityComplete: (identity: EthagentIdentity, message: string, source?: IdentityCompletionSource) => Promise<void>
  onRestoreProgress?: (progress: RestoreProgress | null) => void
  onTokenTransferProgress?: (progress: TokenTransferProgress | null) => void
  onCreateProgress?: (progress: CreateProgress | null) => void
}

export type CreateProgress = {
  phase: 'confirming' | 'writing'
  label: string
}

export type RestoreProgress = {
  phase: 'downloading' | 'decrypting' | 'writing' | 'finishing'
  label: string
  detail?: string
}

export type EffectScope = {
  callbacks: EffectCallbacks
  signal: AbortSignal
  cancel: () => void
}

// Gives one step's work its own cancel signal, so leaving the screen closes
// any wallet approval server or download that step started.
export function scopeCallbacks(callbacks: EffectCallbacks): EffectScope {
  const controller = new AbortController()
  return {
    callbacks: { ...callbacks, signal: controller.signal },
    signal: controller.signal,
    cancel: () => controller.abort(),
  }
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

