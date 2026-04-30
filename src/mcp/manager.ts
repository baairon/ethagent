import { Ajv } from 'ajv'
import { z } from 'zod'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Tool, ToolResult } from '../tools/contracts.js'
import {
  addMcpServerConfig,
  loadMcpConfigs,
  mcpServerTransport,
  parseMcpServerConfigJson,
  type McpConfigIssue,
  type McpServerConfig,
  type ScopedMcpServerConfig,
} from './config.js'
import {
  getProjectMcpDecision,
  isMcpServerDisabled,
  setMcpServerEnabled,
  setProjectMcpDecision,
} from './approvals.js'
import { buildMcpToolName, normalizeNameForMcp, parseMcpToolName } from './names.js'
import {
  formatMcpCallResult,
  formatMcpResourceResult,
  promptMessagesToText,
  truncateMcpOutput,
} from './output.js'

const MCP_CONNECT_TIMEOUT_MS = 10_000
const MCP_LIST_TIMEOUT_MS = 10_000
const MCP_TOOL_TIMEOUT_MS = 120_000

type ListedMcpTool = {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    [key: string]: unknown
  }
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}

export type McpResourceInfo = {
  server: string
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type McpPromptInfo = {
  server: string
  promptName: string
  slashName: string
  description?: string
  arguments?: Array<{ name: string; required?: boolean; description?: string }>
}

export type McpServerSnapshot = {
  name: string
  normalizedName: string
  scope: 'user' | 'project'
  transport: 'stdio' | 'http' | 'sse'
  status: 'pending' | 'connected' | 'failed' | 'disabled' | 'rejected'
  tools: number
  resources: number
  prompts: number
  message?: string
  configHash: string
}

export type McpSnapshot = {
  servers: McpServerSnapshot[]
  issues: McpConfigIssue[]
  prompts: McpPromptInfo[]
}

export const EMPTY_MCP_SNAPSHOT: McpSnapshot = { servers: [], issues: [], prompts: [] }

export type McpRuntime = {
  callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>
  listResources(serverName?: string): Promise<string>
  readResource(serverName: string, uri: string, signal?: AbortSignal): Promise<string>
}

type ConnectedMcpServer = {
  name: string
  normalizedName: string
  config: ScopedMcpServerConfig
  client: Client
  transport: Transport
  tools: ListedMcpTool[]
  resources: McpResourceInfo[]
  prompts: McpPromptInfo[]
}

type ToolIndexEntry = {
  connection: ConnectedMcpServer
  tool: ListedMcpTool
}

const mcpInputSchema = z.object({}).passthrough()
const ajv = new Ajv({ strict: false })

export class McpManager implements McpRuntime {
  private cwd: string
  private closed = false
  private snapshot: McpSnapshot = EMPTY_MCP_SNAPSHOT
  private tools: Tool[] = []
  private connections = new Map<string, ConnectedMcpServer>()
  private toolIndex = new Map<string, ToolIndexEntry>()

  constructor(
    cwd: string,
    private readonly onChange: (snapshot: McpSnapshot) => void,
  ) {
    this.cwd = cwd
  }

  currentSnapshot(): McpSnapshot {
    return this.snapshot
  }

  getTools(): Tool[] {
    return this.tools
  }

  getPromptSuggestions(): Array<{ name: string; summary: string; completion: string; executeOnEnter: boolean }> {
    return this.snapshot.prompts.map(prompt => ({
      name: prompt.slashName.slice(1),
      summary: prompt.description ?? `MCP prompt from ${prompt.server}`,
      completion: `${prompt.slashName} `,
      executeOnEnter: false,
    }))
  }

  async refresh(cwd = this.cwd): Promise<void> {
    if (this.closed) return
    this.cwd = cwd
    await this.closeConnections()
    if (this.closed) return

    const loaded = await loadMcpConfigs(this.cwd)
    const statuses: McpServerSnapshot[] = []
    const promptInfos: McpPromptInfo[] = []
    const nextTools: Tool[] = []
    const seenNormalized = new Set<string>()

    for (const server of loaded.servers) {
      const normalizedName = normalizeNameForMcp(server.name)
      const base: Omit<McpServerSnapshot, 'status' | 'tools' | 'resources' | 'prompts'> = {
        name: server.name,
        normalizedName,
        scope: server.scope,
        transport: mcpServerTransport(server.config),
        configHash: server.configHash,
      }

      if (seenNormalized.has(normalizedName)) {
        statuses.push({ ...base, status: 'failed', tools: 0, resources: 0, prompts: 0, message: 'normalized server name collides with another MCP server' })
        continue
      }
      seenNormalized.add(normalizedName)

      if (await isMcpServerDisabled(this.cwd, server.name)) {
        statuses.push({ ...base, status: 'disabled', tools: 0, resources: 0, prompts: 0 })
        continue
      }

      if (server.scope === 'project') {
        const decision = await getProjectMcpDecision({
          workspaceRoot: this.cwd,
          serverName: server.name,
          configHash: server.configHash,
        })
        if (decision === 'rejected') {
          statuses.push({ ...base, status: 'rejected', tools: 0, resources: 0, prompts: 0, message: 'project server rejected' })
          continue
        }
        if (decision !== 'approved') {
          statuses.push({ ...base, status: 'pending', tools: 0, resources: 0, prompts: 0, message: 'project server needs approval' })
          continue
        }
      }

      const connected = await this.connectServer(server, normalizedName)
      if (!connected.ok) {
        statuses.push({ ...base, status: 'failed', tools: 0, resources: 0, prompts: 0, message: connected.error })
        continue
      }

      this.connections.set(normalizedName, connected.server)
      for (const remoteTool of connected.server.tools) {
        const wrappedTool = this.wrapTool(connected.server, remoteTool)
        this.toolIndex.set(wrappedTool.name, { connection: connected.server, tool: remoteTool })
        nextTools.push(wrappedTool)
      }
      promptInfos.push(...connected.server.prompts)
      statuses.push({
        ...base,
        status: 'connected',
        tools: connected.server.tools.length,
        resources: connected.server.resources.length,
        prompts: connected.server.prompts.length,
      })
    }

    this.tools = nextTools
    this.snapshot = { servers: statuses, issues: loaded.issues, prompts: promptInfos }
    if (!this.closed) this.onChange(this.snapshot)
  }

  async approveServer(serverName: string): Promise<string> {
    const loaded = await loadMcpConfigs(this.cwd)
    const server = findScopedServer(loaded.servers, serverName)
    if (!server) return `MCP server "${serverName}" was not found.`
    if (server.scope !== 'project') return `MCP server "${server.name}" is user-scoped and does not need project approval.`
    await setProjectMcpDecision({
      workspaceRoot: this.cwd,
      serverName: server.name,
      configHash: server.configHash,
      decision: 'approved',
    })
    await this.refresh()
    return `approved MCP project server "${server.name}".`
  }

  async rejectServer(serverName: string): Promise<string> {
    const loaded = await loadMcpConfigs(this.cwd)
    const server = findScopedServer(loaded.servers, serverName)
    if (!server) return `MCP server "${serverName}" was not found.`
    if (server.scope !== 'project') return `MCP server "${server.name}" is user-scoped; disable it instead.`
    await setProjectMcpDecision({
      workspaceRoot: this.cwd,
      serverName: server.name,
      configHash: server.configHash,
      decision: 'rejected',
    })
    await this.refresh()
    return `rejected MCP project server "${server.name}".`
  }

  async setEnabled(serverName: string, enabled: boolean): Promise<string> {
    const loaded = await loadMcpConfigs(this.cwd)
    const server = findScopedServer(loaded.servers, serverName)
    if (!server) return `MCP server "${serverName}" was not found.`
    await setMcpServerEnabled({ workspaceRoot: this.cwd, serverName: server.name, enabled })
    await this.refresh()
    return `${enabled ? 'enabled' : 'disabled'} MCP server "${server.name}".`
  }

  async reconnect(serverName?: string): Promise<string> {
    await this.refresh()
    if (!serverName || serverName === 'all') return 'reconnected MCP servers.'
    const server = findServerSnapshot(this.snapshot.servers, serverName)
    return server ? `reconnected MCP server "${server.name}".` : `MCP server "${serverName}" was not found.`
  }

  async addJson(name: string, json: string, scope: 'user' | 'project'): Promise<string> {
    const config = parseMcpServerConfigJson(json)
    const filePath = await addMcpServerConfig({ cwd: this.cwd, scope, name, config })
    await this.refresh()
    return `added MCP server "${name}" to ${scope} config: ${filePath}`
  }

  renderStatus(): string {
    const lines: string[] = ['mcp servers:']
    if (this.snapshot.servers.length === 0) {
      lines.push('  none configured. use /mcp add-json <name> <json>')
    } else {
      for (const server of this.snapshot.servers) {
        const counts = server.status === 'connected'
          ? ` - ${server.tools} tools, ${server.resources} resources, ${server.prompts} prompts`
          : server.message ? ` - ${server.message}` : ''
        lines.push(`  ${server.name}  ${server.status}  ${server.scope}/${server.transport}${counts}`)
      }
    }
    if (this.snapshot.issues.length > 0) {
      lines.push('', 'mcp config notes:')
      for (const issue of this.snapshot.issues) {
        const server = issue.serverName ? ` ${issue.serverName}` : ''
        lines.push(`  ${issue.severity}${server}: ${issue.message}`)
      }
    }
    return lines.join('\n')
  }

  async runPromptSlash(name: string, argsText: string, signal?: AbortSignal): Promise<string | null> {
    const parsed = parseMcpToolName(name)
    if (!parsed) return null
    const connection = this.connections.get(parsed.serverName)
    if (!connection) return null
    const prompt = connection.prompts.find(entry => normalizeNameForMcp(entry.promptName) === parsed.toolName)
    if (!prompt) return null
    const args = parsePromptArgs(argsText)
    const result = await connection.client.getPrompt(
      { name: prompt.promptName, arguments: Object.keys(args).length > 0 ? args : undefined },
      { signal, timeout: MCP_TOOL_TIMEOUT_MS },
    )
    return promptMessagesToText(result)
  }

  async callTool(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const entry = this.toolIndex.get(name)
    if (!entry) {
      return { ok: false, summary: `${name} not connected`, content: `MCP tool "${name}" is not connected.` }
    }
    try {
      const result = await entry.connection.client.callTool(
        { name: entry.tool.name, arguments: input },
        CallToolResultSchema,
        { signal, timeout: MCP_TOOL_TIMEOUT_MS },
      )
      const formatted = formatMcpCallResult(result)
      return {
        ok: formatted.ok,
        summary: `${entry.connection.name}/${entry.tool.name}`,
        content: formatted.content,
      }
    } catch (err: unknown) {
      return {
        ok: false,
        summary: `${entry.connection.name}/${entry.tool.name} failed`,
        content: (err as Error).message || 'MCP tool failed',
      }
    }
  }

  async listResources(serverName?: string): Promise<string> {
    const connections = serverName
      ? [this.getConnection(serverName)].filter((conn): conn is ConnectedMcpServer => Boolean(conn))
      : [...this.connections.values()]
    if (connections.length === 0) return serverName ? `MCP server "${serverName}" is not connected.` : 'No connected MCP servers.'
    const lines: string[] = []
    for (const connection of connections) {
      lines.push(`${connection.name}:`)
      if (connection.resources.length === 0) {
        lines.push('  no resources')
      } else {
        for (const resource of connection.resources) {
          const mime = resource.mimeType ? ` ${resource.mimeType}` : ''
          const desc = resource.description ? ` - ${resource.description}` : ''
          lines.push(`  ${resource.uri}${mime}${desc}`)
        }
      }
    }
    return lines.join('\n')
  }

  async readResource(serverName: string, uri: string, signal?: AbortSignal): Promise<string> {
    const connection = this.getConnection(serverName)
    if (!connection) return `MCP server "${serverName}" is not connected.`
    const result = await connection.client.readResource({ uri }, { signal, timeout: MCP_TOOL_TIMEOUT_MS })
    return formatMcpResourceResult(result)
  }

  async close(): Promise<void> {
    this.closed = true
    await this.closeConnections()
  }

  private async connectServer(
    config: ScopedMcpServerConfig,
    normalizedName: string,
  ): Promise<{ ok: true; server: ConnectedMcpServer } | { ok: false; error: string }> {
    const client = new Client(
      { name: 'ethagent', version: '1.0.0' },
      { capabilities: {} },
    )
    const transport = createTransport(config.config, this.cwd)
    try {
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS })
      const capabilities = client.getServerCapabilities()
      const tools = capabilities?.tools
        ? (await client.listTools(undefined, { timeout: MCP_LIST_TIMEOUT_MS })).tools as ListedMcpTool[]
        : []
      const resources = capabilities?.resources
        ? (await client.listResources(undefined, { timeout: MCP_LIST_TIMEOUT_MS })).resources.map(resource => ({
          server: config.name,
          uri: resource.uri,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
        }))
        : []
      const prompts = capabilities?.prompts
        ? (await client.listPrompts(undefined, { timeout: MCP_LIST_TIMEOUT_MS })).prompts.map(prompt => ({
          server: config.name,
          promptName: prompt.name,
          slashName: `/${buildMcpToolName(config.name, prompt.name)}`,
          description: prompt.description,
          arguments: prompt.arguments,
        }))
        : []
      return {
        ok: true,
        server: {
          name: config.name,
          normalizedName,
          config,
          client,
          transport,
          tools,
          resources,
          prompts,
        },
      }
    } catch (err: unknown) {
      await transport.close().catch(() => {})
      return { ok: false, error: (err as Error).message || 'MCP connection failed' }
    }
  }

  private wrapTool(connection: ConnectedMcpServer, tool: ListedMcpTool): Tool<typeof mcpInputSchema> {
    const toolName = buildMcpToolName(connection.name, tool.name)
    const validate = ajv.compile(tool.inputSchema)
    const readOnly = tool.annotations?.readOnlyHint === true
    return {
      name: toolName,
      kind: 'mcp',
      readOnly,
      description: tool.description ?? `MCP tool ${tool.name} from ${connection.name}`,
      inputSchema: mcpInputSchema,
      inputSchemaJson: normalizeInputSchemaJson(tool.inputSchema),
      parse(input) {
        const parsed = mcpInputSchema.parse(input)
        if (!validate(parsed)) {
          throw new Error(`MCP tool input failed schema validation: ${ajv.errorsText(validate.errors)}`)
        }
        return parsed
      },
      async buildPermissionRequest() {
        return {
          kind: 'mcp',
          title: 'allow MCP tool?',
          subtitle: `${connection.name} / ${tool.name}`,
          serverName: connection.name,
          normalizedServerName: connection.normalizedName,
          toolName: tool.name,
          toolKey: toolName,
          readOnly,
          destructive: tool.annotations?.destructiveHint === true,
          openWorld: tool.annotations?.openWorldHint === true,
          canPersistServer: true,
        }
      },
      async execute(input, context) {
        if (!context.mcp) {
          return { ok: false, summary: `${toolName} unavailable`, content: 'MCP runtime is not available.' }
        }
        return context.mcp.callTool(toolName, input, context.abortSignal)
      },
    }
  }

  private getConnection(serverName: string): ConnectedMcpServer | undefined {
    const normalized = normalizeNameForMcp(serverName)
    return this.connections.get(normalized) ?? [...this.connections.values()].find(conn => conn.name === serverName)
  }

  private async closeConnections(): Promise<void> {
    for (const connection of this.connections.values()) {
      await connection.transport.close().catch(() => {})
    }
    this.connections.clear()
    this.toolIndex.clear()
    this.tools = []
  }
}

function createTransport(config: McpServerConfig, cwd: string): Transport {
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

function mergeProcessEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return { ...env, ...extra }
}

function normalizeInputSchemaJson(schema: ListedMcpTool['inputSchema']): Tool['inputSchemaJson'] {
  return {
    type: 'object',
    properties: schema.properties,
    required: schema.required,
    oneOf: Array.isArray(schema.oneOf) ? schema.oneOf as Array<Record<string, unknown>> : undefined,
    anyOf: Array.isArray(schema.anyOf) ? schema.anyOf as Array<Record<string, unknown>> : undefined,
    additionalProperties: schema.additionalProperties as boolean | undefined,
  }
}

function findScopedServer(servers: ScopedMcpServerConfig[], name: string): ScopedMcpServerConfig | undefined {
  const normalized = normalizeNameForMcp(name)
  return servers.find(server => server.name === name || normalizeNameForMcp(server.name) === normalized)
}

function findServerSnapshot(servers: McpServerSnapshot[], name: string): McpServerSnapshot | undefined {
  const normalized = normalizeNameForMcp(name)
  return servers.find(server => server.name === name || server.normalizedName === normalized)
}

function parsePromptArgs(value: string): Record<string, string> {
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
