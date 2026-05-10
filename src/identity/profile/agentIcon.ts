import path from 'node:path'

const AGENT_ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp4', '.webm', '.mov'] as const

export function validateAgentIconReference(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return 'enter an Agent Icon URL or local file path'
  if (hasUnsupportedUrlScheme(trimmed)) return 'Agent Icon must be a local path, https URL, or ipfs:// URL'
  if (!agentIconExtension(trimmed)) return 'Agent Icon must be png, jpg, jpeg, gif, webp, svg, mp4, webm, or mov'
  return null
}

export function isAgentIconUrl(input: string): boolean {
  return /^(https|ipfs):\/\//i.test(input.trim())
}

export function agentIconContentType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    default:
      return 'application/octet-stream'
  }
}

function agentIconExtension(input: string): string | null {
  const pathname = isAgentIconUrl(input) ? urlPathname(input) : input
  const ext = path.extname(pathname).toLowerCase()
  return AGENT_ICON_EXTENSIONS.includes(ext as typeof AGENT_ICON_EXTENSIONS[number]) ? ext : null
}

function urlPathname(input: string): string {
  try {
    const url = new URL(input)
    return `${url.hostname}${url.pathname}`
  } catch {
    return input.split(/[?#]/, 1)[0] ?? input
  }
}

function hasUnsupportedUrlScheme(input: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)
  if (!match) return false
  return !/^(https|ipfs)$/i.test(match[1] ?? '')
}
