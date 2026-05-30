import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { snapshotSaveRequiresOwnerSigner } from '../continuity/snapshot.js'
import type { IdentityManagerInitialAction } from '../types.js'
import type { ProfileUpdates, Step } from '../reducer.js'

export function isWalletCancelled(err: unknown): boolean {
  if (!err) return false
  const message = err instanceof Error ? err.message : String(err)
  return /wallet request was cancelled/i.test(message)
    || /user rejected/i.test(message)
}

export function isStorageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /pinata|ipfs|pin|storage/i.test(message)
}

const MIN_BUSY_ERROR_MS = 2000

export function waitForMinimumBusyTime(startedAt: number): Promise<void> {
  const remaining = MIN_BUSY_ERROR_MS - (Date.now() - startedAt)
  return remaining > 0
    ? new Promise(resolve => setTimeout(resolve, remaining))
    : Promise.resolve()
}

export function capitalizeFeedbackMessage(message: string): string {
  return message.replace(/^(\s*)([a-z])/, (_match, leading: string, first: string) => `${leading}${first.toUpperCase()}`)
}

export function rebackupWalletApprovalView(
  identity: EthagentIdentity,
  profileUpdates?: ProfileUpdates,
): { title: string; subtitle: string; label: string } {
  if (snapshotSaveRequiresOwnerSigner(identity, profileUpdates)) {
    return {
      title: 'Use Owner Wallet',
      subtitle: 'Owner wallet signs this custody-controlled identity update.',
      label: 'waiting for owner wallet signature...',
    }
  }
  return {
    title: 'Use Wallet',
    subtitle: 'Owner or operator wallet signs the encrypted snapshot and token URI update.',
    label: 'waiting for wallet signature...',
  }
}

export function isCreateStep(step: Step): step is Extract<Step, { kind: 'replace-confirm' | 'create-name' | 'create-description' | 'create-custody' | 'create-import' | 'create-preflight' | 'create-registry' | 'create-signing' | 'create-storage' }> {
  return step.kind === 'replace-confirm'
    || step.kind === 'create-name'
    || step.kind === 'create-description'
    || step.kind === 'create-custody'
    || step.kind === 'create-import'
    || step.kind === 'create-preflight'
    || step.kind === 'create-registry'
    || step.kind === 'create-signing'
    || step.kind === 'create-storage'
}

export function isRestoreStep(step: Step): step is Exclude<Extract<Step, { kind: `restore-${string}` }>, { kind: 'restore-wallet' | 'restore-network' }> {
  return step.kind.startsWith('restore-') && step.kind !== 'restore-wallet' && step.kind !== 'restore-network'
}

export function initialStepForAction(
  action: IdentityManagerInitialAction | undefined,
  config: EthagentConfig | undefined,
): Step {
  if (action === 'create') return config?.identity ? { kind: 'replace-confirm', next: 'create' } : { kind: 'create-name' }
  if (action === 'load') return { kind: 'restore-wallet', purpose: config?.identity ? 'switch' : 'restore' }
  if (action === 'save-snapshot') return config?.identity ? { kind: 'rebackup-start', back: { kind: 'menu' } } : { kind: 'menu' }
  if (action === 'save-prompt') return config?.identity ? { kind: 'save-prompt', back: { kind: 'menu' } } : { kind: 'menu' }
  if (action === 'settings') return { kind: 'menu' }
  return { kind: 'menu' }
}
