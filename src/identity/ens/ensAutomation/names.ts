import { isEthDomain, normalizeEthDomain, splitSubdomainName } from '../ensLookup.js'

export function isRootEthName(value: string): boolean {
  const normalized = normalizeEthDomain(value)
  return isEthDomain(normalized) && normalized.split('.').length === 2
}

export function isValidSubdomainLabel(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value) && !value.startsWith('-') && !value.endsWith('-')
}

export function hasValidSubdomainParts(fullName: string): boolean {
  return Boolean(splitSubdomainName(fullName))
}
