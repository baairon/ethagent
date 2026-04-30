export function normalizeNameForMcp(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'unnamed'
}

export function mcpToolPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMcp(serverName)}__`
}

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${mcpToolPrefix(serverName)}${normalizeNameForMcp(toolName)}`
}

export function parseMcpToolName(value: string): { serverName: string; toolName: string } | null {
  const parts = value.split('__')
  const [prefix, serverName, ...toolNameParts] = parts
  if (prefix !== 'mcp' || !serverName || toolNameParts.length === 0) return null
  return { serverName, toolName: toolNameParts.join('__') }
}
