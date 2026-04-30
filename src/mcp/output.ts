export const MAX_MCP_OUTPUT_CHARS = 100_000

export function formatMcpCallResult(result: unknown): { ok: boolean; content: string } {
  if (isRecord(result) && 'toolResult' in result) {
    return { ok: true, content: truncateMcpOutput(formatUnknown(result.toolResult)) }
  }

  const isError = isRecord(result) && result.isError === true
  const parts: string[] = []
  if (isRecord(result) && Array.isArray(result.content)) {
    for (const block of result.content) parts.push(formatContentBlock(block))
  }
  if (isRecord(result) && isRecord(result.structuredContent)) {
    parts.push(`structuredContent:\n${JSON.stringify(result.structuredContent, null, 2)}`)
  }
  if (parts.length === 0) parts.push(formatUnknown(result))
  const content = parts.filter(Boolean).join('\n\n')
  return { ok: !isError, content: truncateMcpOutput(isError ? annotateMcpError(content) : content) }
}

export function formatMcpResourceResult(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.contents)) return truncateMcpOutput(formatUnknown(result))
  return truncateMcpOutput(result.contents.map(content => {
    if (!isRecord(content)) return formatUnknown(content)
    const uri = typeof content.uri === 'string' ? content.uri : 'resource'
    const mime = typeof content.mimeType === 'string' ? ` (${content.mimeType})` : ''
    if (typeof content.text === 'string') return `${uri}${mime}\n${content.text}`
    if (typeof content.blob === 'string') return `${uri}${mime}\n[binary blob ${content.blob.length} base64 chars]`
    return `${uri}${mime}\n${formatUnknown(content)}`
  }).join('\n\n'))
}

export function truncateMcpOutput(value: string): string {
  if (value.length <= MAX_MCP_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_MCP_OUTPUT_CHARS)}\n\n[OUTPUT TRUNCATED - exceeded ${MAX_MCP_OUTPUT_CHARS.toLocaleString()} characters. If this MCP server supports pagination or filters, call it again for a narrower result.]`
}

export function promptMessagesToText(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.messages)) return formatUnknown(result)
  return result.messages.map(message => {
    if (!isRecord(message)) return formatUnknown(message)
    const role = typeof message.role === 'string' ? message.role : 'user'
    const content = formatContentBlock(message.content)
    return `${role}:\n${content}`
  }).join('\n\n')
}

function formatContentBlock(block: unknown): string {
  if (!isRecord(block)) return formatUnknown(block)
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  if (block.type === 'image') {
    const mime = typeof block.mimeType === 'string' ? block.mimeType : 'image'
    const data = typeof block.data === 'string' ? ` ${block.data.length} base64 chars` : ''
    return `[image ${mime}${data}]`
  }
  if (block.type === 'audio') {
    const mime = typeof block.mimeType === 'string' ? block.mimeType : 'audio'
    const data = typeof block.data === 'string' ? ` ${block.data.length} base64 chars` : ''
    return `[audio ${mime}${data}]`
  }
  if (block.type === 'resource' && isRecord(block.resource)) {
    const resource = block.resource
    const uri = typeof resource.uri === 'string' ? resource.uri : 'resource'
    if (typeof resource.text === 'string') return `${uri}\n${resource.text}`
    if (typeof resource.blob === 'string') return `${uri}\n[binary blob ${resource.blob.length} base64 chars]`
  }
  if (block.type === 'resource_link') {
    const name = typeof block.name === 'string' ? block.name : 'resource'
    const uri = typeof block.uri === 'string' ? block.uri : ''
    return `[resource link ${name}${uri ? ` ${uri}` : ''}]`
  }
  return formatUnknown(block)
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}

function annotateMcpError(content: string): string {
  const lower = content.toLowerCase()
  const looksRateLimited = lower.includes('rate limit') ||
    lower.includes('too quickly') ||
    lower.includes('429') ||
    lower.includes('ddg detected an anomaly')

  if (!looksRateLimited) return content
  return [
    content,
    '[MCP server returned an upstream rate-limit or anti-abuse error; the MCP transport is still connected. Wait before retrying or use an API-key-backed search server for frequent searches.]',
  ].join('\n\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
