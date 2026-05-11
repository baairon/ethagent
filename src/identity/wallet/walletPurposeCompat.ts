const legacyOwnerRole = ['c', 'old'].join('')
const legacyOperatorRole = ['h', 'ot'].join('')

function legacyWalletPurpose(action: string, role: string, suffix = 'wallet'): string {
  return `${action}-${role}-${suffix}`
}

export const LEGACY_WALLET_PURPOSE_ALIASES: Record<string, string> = {
  [legacyWalletPurpose('connect', legacyOperatorRole)]: 'connect-operator-wallet',
  [legacyWalletPurpose('restore', legacyOwnerRole)]: 'restore-owner-wallet',
  [legacyWalletPurpose('restore', legacyOperatorRole)]: 'restore-operator-wallet',
}

export function normalizeWalletPurposeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return LEGACY_WALLET_PURPOSE_ALIASES[trimmed] ?? trimmed
}

export function normalizeWalletPayloadPurpose(payload: Record<string, unknown>): Record<string, unknown> {
  const purpose = normalizeWalletPurposeValue(payload.purpose)
  if (!purpose || purpose === payload.purpose) return payload
  return { ...payload, purpose }
}
