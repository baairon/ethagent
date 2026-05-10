
export function objectField(input: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  if (!input) return null
  const value = input[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function arrayField(input: Record<string, unknown> | null | undefined, key: string): Array<unknown> | null {
  if (!input) return null
  const value = input[key]
  return Array.isArray(value) ? value : null
}

export function stringField(input: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function numberField(input: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const value = input?.[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function booleanField(input: Record<string, unknown> | null | undefined, key: string): boolean | undefined {
  const value = input?.[key]
  return typeof value === 'boolean' ? value : undefined
}
