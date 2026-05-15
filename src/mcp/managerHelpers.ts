import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '../tools/contracts.js'
import type { McpServerConfig, ScopedMcpServerConfig } from './config.js'
import { normalizeNameForMcp } from './names.js'
import type { ListedMcpTool, McpServerSnapshot } from './manager.js'

export function createTransport(config: McpServerConfig, cwd: string): Transport {
  if (config.type === 'http') {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    })
  }
  if (config.type === 'sse') {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
      eventSourceInit: config.headers ? { fetch: (url, init) => fetch(url, { ...init, headers: config.headers }) } : undefined,
    })
  }
  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env ? mergeProcessEnv(config.env) : undefined,
    cwd: config.cwd ?? cwd,
    stderr: 'pipe',
  })
}

export function normalizeInputSchemaJson(schema: ListedMcpTool['inputSchema']): Tool['inputSchemaJson'] {
  return {
    type: 'object',
    properties: schema.properties,
    required: schema.required,
    oneOf: Array.isArray(schema.oneOf) ? schema.oneOf as Array<Record<string, unknown>> : undefined,
    anyOf: Array.isArray(schema.anyOf) ? schema.anyOf as Array<Record<string, unknown>> : undefined,
    additionalProperties: schema.additionalProperties as boolean | undefined,
  }
}

export function findScopedServer(servers: ScopedMcpServerConfig[], name: string): ScopedMcpServerConfig | undefined {
  const normalized = normalizeNameForMcp(name)
  return servers.find(server => server.name === name || normalizeNameForMcp(server.name) === normalized)
}

export function findServerSnapshot(servers: McpServerSnapshot[], name: string): McpServerSnapshot | undefined {
  const normalized = normalizeNameForMcp(name)
  return servers.find(server => server.name === name || server.normalizedName === normalized)
}

export function parsePromptArgs(value: string): Record<string, string> {
  const args: Record<string, string> = {}
  for (const token of value.trim().split(/\s+/).filter(Boolean)) {
    const idx = token.indexOf('=')
    if (idx === -1) continue
    const key = token.slice(0, idx)
    if (!key) continue
    args[key] = token.slice(idx + 1)
  }
  return args
}

function mergeProcessEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...extra }
}
