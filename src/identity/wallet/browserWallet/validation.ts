import { getAddress, type Address, type Hex } from 'viem'
import { recoverAddressFromSignature } from '../../crypto/eth.js'
import { normalizeWalletPurposeValue } from '../walletPurposeCompat.js'
import type { BrowserWalletErrorPayload, WalletPurpose } from './types.js'

export function assertExpectedAccount(account: Address, expectedAccount: Address | undefined, purpose?: WalletPurpose): void {
  if (expectedAccount && account.toLowerCase() !== expectedAccount.toLowerCase()) {
    throw accountMismatchError(account, expectedAccount, purpose)
  }
}

export function verifyRecoveredAccount(message: string, signature: Hex, account: Address): void {
  const recovered = recoverAddressFromSignature(message, signature)
  if (recovered.toLowerCase() !== account.toLowerCase()) {
    throw new Error('Wallet signature does not match connected account')
  }
}

export function parseBrowserWalletErrorBody(body: Record<string, unknown>): BrowserWalletErrorPayload {
  const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : 'Wallet request failed'
  const code = typeof body.code === 'string' && body.code.trim() ? body.code.trim() : undefined
  const data = typeof body.data === 'string' && body.data.trim() ? body.data.trim() : undefined
  const rawCauses = Array.isArray(body.causes) ? body.causes : []
  const causes = rawCauses.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).slice(0, 5)
  const method = typeof body.method === 'string' && body.method.trim() ? body.method.trim() : undefined
  const purpose = normalizeWalletPurposeValue(body.purpose)
  const chainIdHex = typeof body.chainIdHex === 'string' && body.chainIdHex.trim() ? body.chainIdHex.trim() : undefined
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined
  return { message, code, data, causes, method, purpose, chainIdHex, title }
}

export function parseAccount(value: unknown): Address {
  if (typeof value !== 'string') throw new Error('Wallet account is missing')
  return getAddress(value)
}

export function parseHex(value: unknown, label: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${label} is invalid`)
  return value as Hex
}

export function accountMismatchError(account: Address, expectedAccount: Address, purpose?: WalletPurpose): Error {
  if (isOwnerWalletPurpose(purpose)) {
    return new Error(`Owner Wallet Required: connected wallet ${account} does not match owner wallet ${expectedAccount}`)
  }
  if (isOperatorWalletPurpose(purpose)) {
    return new Error(`Operator Wallet Required: connected wallet ${account} does not match operator wallet ${expectedAccount}`)
  }
  if (purpose === 'prepare-transfer-sender' || purpose === 'publish-transfer-snapshot') {
    return new Error(`Sender Wallet Required: connected wallet ${account} does not match sender wallet ${expectedAccount}`)
  }
  if (purpose === 'prepare-transfer-target') {
    return new Error(`Receiver Wallet Required: connected wallet ${account} does not match receiver wallet ${expectedAccount}. Switch accounts in your wallet to the receiver address and retry.`)
  }
  return new Error(`Connected wallet ${account} does not match expected wallet ${expectedAccount}`)
}

export function assertSessionToken(body: Record<string, unknown>, sessionToken: string): void {
  if (body.sessionToken !== sessionToken) throw new Error('Wallet session token is invalid')
}

export function chainIdHex(chainId: number): Hex {
  return `0x${chainId.toString(16)}` as Hex
}

function isOwnerWalletPurpose(purpose: WalletPurpose | undefined): boolean {
  return purpose === 'restore-owner-wallet'
    || purpose === 'create-agent'
    || purpose === 'create-agent-ens-subdomain'
    || purpose === 'set-agent-ens-records'
    || purpose === 'update-operators'
    || purpose === 'update-snapshot-owner'
    || purpose === 'update-profile-owner'
    || purpose === 'update-ens'
    || purpose === 'clear-ens'
    || purpose === 'deploy-agent-vault'
    || purpose === 'sync-operator-vault'
    || purpose === 'rotate-agent-uri-vault-owner'
}

function isOperatorWalletPurpose(purpose: WalletPurpose | undefined): boolean {
  return purpose === 'restore-operator-wallet'
    || purpose === 'operator-proof'
    || purpose === 'connect-operator-wallet'
    || purpose === 'update-snapshot-operator'
    || purpose === 'update-profile-operator'
    || purpose === 'rotate-agent-uri-vault-operator'
}
