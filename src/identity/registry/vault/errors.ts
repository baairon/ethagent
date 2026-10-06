import { decodeErrorResult, type Hex } from 'viem'
import { VAULT_ABI } from './constants.js'

export type VaultRevertName = 'AlreadyDeposited' | 'UnexpectedToken' | 'NotOwner' | 'NotAuthorized'

const VAULT_REVERT_TEXT: Record<VaultRevertName, string> = {
  AlreadyDeposited: 'the Vault already holds a token (AlreadyDeposited)',
  UnexpectedToken: 'this Vault was deployed for a different registry or token (UnexpectedToken)',
  NotOwner: 'only the wallet that deposited the token may do this (NotOwner)',
  NotAuthorized: 'the signer is neither the depositor nor an approved operator (NotAuthorized)',
}

function revertDataOf(err: unknown): Hex | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const item = current as { data?: unknown; raw?: unknown; cause?: unknown }
    for (const candidate of [item.data, item.raw, (item.data as { data?: unknown } | undefined)?.data]) {
      if (typeof candidate === 'string' && /^0x[0-9a-fA-F]{8}/.test(candidate)) return candidate as Hex
    }
    const named = (item.data as { errorName?: unknown } | undefined)?.errorName
    if (typeof named === 'string' && named in VAULT_REVERT_TEXT) return undefined
    current = item.cause
  }
  return undefined
}

// The Vault's custom error behind a refusal, from a revert's data or viem's decoded
// error, whichever the error chain carries.
export function vaultRevertName(err: unknown): VaultRevertName | undefined {
  let current: unknown = err
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const named = ((current as { data?: unknown }).data as { errorName?: unknown } | undefined)?.errorName
    if (typeof named === 'string' && named in VAULT_REVERT_TEXT) return named as VaultRevertName
    current = (current as { cause?: unknown }).cause
  }
  const data = revertDataOf(err)
  if (!data) return undefined
  try {
    const decoded = decodeErrorResult({ abi: VAULT_ABI, data })
    return decoded.errorName in VAULT_REVERT_TEXT ? decoded.errorName as VaultRevertName : undefined
  } catch {
    return undefined
  }
}

export function describeVaultRevert(err: unknown): string | undefined {
  const name = vaultRevertName(err)
  return name ? VAULT_REVERT_TEXT[name] : undefined
}
