const LEGACY_OWNER_ADDRESS_KEY = ['c', 'oldOwnerAddress'].join('')
const OPERATOR_VAULT_ADDRESS_KEY = 'operatorVaultAddress'

export function readOwnerAddressField(input: Record<string, unknown> | null | undefined): string | undefined {
  const current = stringValue(input?.ownerAddress)
  if (current) return current
  return stringValue(input?.[LEGACY_OWNER_ADDRESS_KEY])
}

export function setOwnerAddressField(target: Record<string, unknown>, value: string): void {
  delete target[LEGACY_OWNER_ADDRESS_KEY]
  target.ownerAddress = value
}

export function clearOwnerAddressField(target: Record<string, unknown>): void {
  delete target.ownerAddress
  delete target[LEGACY_OWNER_ADDRESS_KEY]
}

export function readVaultAddressField(input: Record<string, unknown> | null | undefined): string | undefined {
  return stringValue(input?.[OPERATOR_VAULT_ADDRESS_KEY])
}

export function setVaultAddressField(target: Record<string, unknown>, value: string): void {
  target[OPERATOR_VAULT_ADDRESS_KEY] = value
}

export function clearVaultAddressField(target: Record<string, unknown>): void {
  delete target[OPERATOR_VAULT_ADDRESS_KEY]
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
