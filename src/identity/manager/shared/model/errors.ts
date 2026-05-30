import { ZodError } from 'zod'
import { RegisterAgentPreflightError } from '../../../registry/erc8004.js'
import { AgentStateOwnerMismatchError } from '../../../crypto/backupEnvelope.js'
import {
  ContinuitySnapshotOwnerMismatchError,
  ContinuityTransferSnapshotTargetMismatchError,
} from '../../../continuity/envelope.js'
import {
  VaultBytecodeMismatchError,
  formatVaultBytecodeMismatchDetail,
} from '../../../registry/vault.js'
import { BrowserWalletError } from '../../../wallet/browserWallet.js'
import { PinataUploadError } from '../../../storage/ipfs.js'
import { TxGuardBusyError } from '../txGuard.js'
import { shortAddress } from './format.js'

export type IdentityManagerErrorView = {
  title: string
  detail?: string
  hint?: string
}

export function identityManagerErrorView(err: unknown): IdentityManagerErrorView {
  if (err instanceof ZodError) {
    const issue = err.issues[0]
    const path = issue?.path.join('.') ?? ''
    const message = issue?.message ?? 'Schema validation failed.'
    return {
      title: 'Config Validation Failed',
      detail: path ? `${path}: ${message}` : message,
      hint: 'Internal: a config write was attempted before required fields were set. Restart First Run if this persists.',
    }
  }
  if (err instanceof TxGuardBusyError) {
    return {
      title: 'Already In Progress',
      detail: err.message,
      hint: 'Approve or cancel the open wallet popup, then retry.',
    }
  }
  if (err instanceof RegisterAgentPreflightError) {
    return {
      title: err.title,
      detail: err.detail,
      hint: err.hint,
    }
  }
  if (err instanceof AgentStateOwnerMismatchError) {
    return {
      title: 'Backup Locked to Another Wallet',
      detail: `Wallet ${shortAddress(err.currentOwner)} cannot read state encrypted for ${shortAddress(err.backupOwner)}.`,
      hint: 'Use the wallet that created this backup.',
    }
  }
  if (err instanceof ContinuitySnapshotOwnerMismatchError) {
    return {
      title: 'Snapshot Locked to Previous Wallet',
      detail: 'This token points at an owner-only snapshot. Ask the previous owner to prepare a transfer snapshot before transferring.',
      hint: `Current wallet ${shortAddress(err.currentOwner)} cannot read the snapshot encrypted for ${shortAddress(err.snapshotOwner)}.`,
    }
  }
  if (err instanceof ContinuityTransferSnapshotTargetMismatchError) {
    return {
      title: 'Transfer Snapshot Receiver Mismatch',
      detail: `This transfer snapshot is for receiver ${shortAddress(err.targetOwner)}, but the current token owner is ${shortAddress(err.currentOwner)}.`,
      hint: `Prepare a new transfer snapshot from ${shortAddress(err.snapshotOwner)} to the intended receiver wallet.`,
    }
  }
  if (err instanceof VaultBytecodeMismatchError) {
    return {
      title: 'Vault Bytecode Mismatch',
      detail: formatVaultBytecodeMismatchDetail(err),
      hint: 'Open the deploy tx on the block explorer and confirm the input data matches the Vault deploy bytecode plus constructor args before retrying. A persistent mismatch usually means the wallet or RPC substituted the create.',
    }
  }
  if (err instanceof BrowserWalletError) {
    const lines: string[] = []
    if (err.purpose) lines.push(`Action: ${err.purpose}`)
    if (err.method) lines.push(`Method: ${err.method}`)
    if (err.code) lines.push(`Code: ${err.code}`)
    lines.push(`Wallet: ${err.message}`)
    if (err.causes.length) {
      for (const cause of err.causes) lines.push(`Caused by: ${cause}`)
    }
    if (err.data) lines.push(`Data: ${err.data}`)
    return {
      title: err.title ?? 'Wallet Error',
      detail: lines.join('\n'),
      hint: 'Switch to the expected wallet, confirm you have funds, then retry. If the wallet keeps reporting an internal RPC error, change the RPC endpoint in your wallet settings.',
    }
  }
  if (err instanceof PinataUploadError) {
    if (err.status === 403) {
      return {
        title: 'Pinata Storage Limit Reached',
        detail: 'Pinata refused the upload (403). Your account is likely at its file or storage limit; the free plan caps at 500 files.',
        hint: 'Check your usage at https://app.pinata.cloud, remove old pins or upgrade your plan, then try again.',
      }
    }
    if (err.status === 401) {
      return {
        title: 'Pinata Rejected the Credential',
        detail: 'Pinata rejected the upload (401). Your Pinata JWT is invalid or expired.',
        hint: 'Update your Pinata JWT in Storage settings, then try again.',
      }
    }
    if (err.status === 429) {
      return {
        title: 'Pinata Rate Limited',
        detail: 'Pinata is throttling uploads (429): too many requests in a short window.',
        hint: 'Wait a moment, then try again.',
      }
    }
    return {
      title: 'Pinata Upload Failed',
      detail: err.message,
      hint: 'Check your Pinata account status at https://app.pinata.cloud, then try again.',
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/^owner wallet required:/i.test(message)) {
    return {
      title: 'Owner Wallet Required',
      detail: capitalizeErrorText(message.replace(/^owner wallet required:\s*/i, '')),
      hint: 'Switch to the owner wallet, then try again.',
    }
  }
  if (/^operator wallet required:/i.test(message)) {
    return {
      title: 'Operator Wallet Required',
      detail: capitalizeErrorText(message.replace(/^operator wallet required:\s*/i, '')),
      hint: 'Switch to the operator wallet, then try again.',
    }
  }
  if (/^Restore Slot Missing:/i.test(message)) {
    return {
      title: 'Wallet Not Included In Snapshot',
      detail: 'ERC-8004 metadata authorizes this wallet, but the latest encrypted snapshot was saved before this wallet had restore access.',
      hint: 'Use the owner wallet once to save a fresh snapshot, then restore with this wallet.',
    }
  }
  if (message === 'fetch failed') {
    return {
      title: 'Storage Unavailable',
      detail: 'Could not reach storage.',
      hint: 'Check the connection, then try again.',
    }
  }
  return {
    title: 'Identity Error',
    detail: capitalizeErrorText(message),
  }
}

export function pinataErrorText(err: unknown): string {
  const view = identityManagerErrorView(err)
  return view.detail ?? view.title
}

export function isRegistrationPreflightError(err: unknown): boolean {
  return err instanceof RegisterAgentPreflightError
}

function capitalizeErrorText(value: string): string {
  const trimmed = value.trim()
  if (/^wallet request timed out$/i.test(trimmed)) return 'Wallet Request Timed Out'
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
