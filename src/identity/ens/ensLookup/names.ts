import { ETH_NAME_PATTERN } from './constants.js'

export function isEthDomain(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed.endsWith('.eth')) return false
  if (trimmed === '.eth') return false
  return ETH_NAME_PATTERN.test(trimmed)
}

export function normalizeEthDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '')
}

export function sanitizeSubdomainPrefix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

type SubdomainParts = { parent: string; label: string }

export function splitSubdomainName(fullName: string): SubdomainParts | null {
  const trimmed = fullName.trim().toLowerCase()
  if (!isEthDomain(trimmed)) return null
  const dot = trimmed.indexOf('.')
  if (dot <= 0 || dot === trimmed.length - 1) return null
  const label = trimmed.slice(0, dot)
  const parent = trimmed.slice(dot + 1)
  if (!isEthDomain(parent)) return null
  if (!/^[a-z0-9-]+$/.test(label)) return null
  return { parent, label }
}
