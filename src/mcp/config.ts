import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { ensureConfigDir, getConfigDir } from '../storage/config.js'

export type McpConfigScope = 'user' | 'project'

const McpStdioServerConfigSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().min(1).optional(),
})

const McpHttpServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
})

const McpSseServerConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
})

export const McpServerConfigSchema = z.union([
  McpStdioServerConfigSchema,
  McpHttpServerConfigSchema,
  McpSseServerConfigSchema,
])

export const McpJsonConfigSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema),
})

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpJsonConfig = z.infer<typeof McpJsonConfigSchema>

export type ScopedMcpServerConfig = {
  name: string
  scope: McpConfigScope
  config: McpServerConfig
  configHash: string
}

export type McpConfigIssue = {
  scope: McpConfigScope
  filePath: string
  serverName?: string
  severity: 'error' | 'warning'
  message: string
}

export type LoadedMcpConfigs = {
  servers: ScopedMcpServerConfig[]
  issues: McpConfigIssue[]
}

export function getUserMcpConfigPath(): string {
  return path.join(getConfigDir(), 'mcp.json')
}

export function getProjectMcpConfigPath(cwd: string): string {
  return path.join(path.resolve(cwd), '.mcp.json')
}

export async function loadMcpConfigs(cwd: string): Promise<LoadedMcpConfigs> {
  const user = await readMcpConfigFile(getUserMcpConfigPath(), 'user', true)
  const project = await readMcpConfigFile(getProjectMcpConfigPath(cwd), 'project', true)
  const byName = new Map<string, ScopedMcpServerConfig>()
  for (const server of user.servers) byName.set(server.name, server)
  for (const server of project.servers) byName.set(server.name, server)
  return {
    servers: [...byName.values()],
    issues: [...user.issues, ...project.issues],
  }
}

export async function addMcpServerConfig(params: {
  cwd: string
  scope: McpConfigScope
  name: string
  config: McpServerConfig
}): Promise<string> {
  const filePath = params.scope === 'user' ? getUserMcpConfigPath() : getProjectMcpConfigPath(params.cwd)
  const current = await readRawMcpConfig(filePath)
  current.mcpServers[params.name] = params.config
  if (params.scope === 'user') await ensureConfigDir()
  await atomicWriteText(filePath, JSON.stringify(current, null, 2) + '\n')
  return filePath
}

export function parseMcpServerConfigJson(value: string): McpServerConfig {
  return McpServerConfigSchema.parse(JSON.parse(value))
}

export function mcpServerTransport(config: McpServerConfig): 'stdio' | 'http' | 'sse' {
  return config.type === 'http' || config.type === 'sse' ? config.type : 'stdio'
}

export function stableMcpConfigHash(config: McpServerConfig): string {
  return crypto.createHash('sha256').update(stableJson(config)).digest('hex').slice(0, 16)
}

async function readMcpConfigFile(
  filePath: string,
  scope: McpConfigScope,
  expandVars: boolean,
): Promise<LoadedMcpConfigs> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { servers: [], issues: [] }
    return {
      servers: [],
      issues: [{ scope, filePath, severity: 'error', message: `failed to read MCP config: ${(err as Error).message}` }],
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch (err: unknown) {
    return {
      servers: [],
      issues: [{ scope, filePath, severity: 'error', message: `MCP config is not valid JSON: ${(err as Error).message}` }],
    }
  }

  const parsed = McpJsonConfigSchema.safeParse(parsedJson)
  if (!parsed.success) {
    return {
      servers: [],
      issues: parsed.error.issues.map(issue => ({
        scope,
        filePath,
        severity: 'error',
        message: `MCP config schema error at ${issue.path.join('.') || 'root'}: ${issue.message}`,
      })),
    }
  }

  const servers: ScopedMcpServerConfig[] = []
  const issues: McpConfigIssue[] = []
  for (const [name, config] of Object.entries(parsed.data.mcpServers)) {
    const expanded = expandVars ? expandEnvVars(config) : { config, missing: [] }
    if (expanded.missing.length > 0) {
      issues.push({
        scope,
        filePath,
        serverName: name,
        severity: 'warning',
        message: `missing environment variables: ${expanded.missing.join(', ')}`,
      })
    }
    if (process.platform === 'win32' && 'command' in expanded.config && isBareNpxCommand(expanded.config.command)) {
      issues.push({
        scope,
        filePath,
        serverName: name,
        severity: 'warning',
        message: 'Windows MCP stdio servers should use command "cmd" with args ["/c", "npx", ...]',
      })
    }
    servers.push({
      name,
      scope,
      config: expanded.config,
      configHash: stableMcpConfigHash(expanded.config),
    })
  }
  return { servers, issues }
}

async function readRawMcpConfig(filePath: string): Promise<McpJsonConfig> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { mcpServers: {} }
    throw err
  }
  return McpJsonConfigSchema.parse(JSON.parse(raw))
}

function expandEnvVars(config: McpServerConfig): { config: McpServerConfig; missing: string[] } {
  const missing = new Set<string>()
  const expanded = expandValue(config, missing)
  return { config: McpServerConfigSchema.parse(expanded), missing: [...missing].sort() }
}

function expandValue(value: unknown, missing: Set<string>): unknown {
  if (typeof value === 'string') return expandString(value, missing)
  if (Array.isArray(value)) return value.map(item => expandValue(item, missing))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) out[key] = expandValue(child, missing)
    return out
  }
  return value
}

function expandString(value: string, missing: Set<string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
    const envValue = process.env[name]
    if (envValue !== undefined) return envValue
    if (fallback !== undefined) return fallback
    missing.add(name)
    return ''
  })
}

function isBareNpxCommand(command: string): boolean {
  const normalized = command.replace(/\\/g, '/').toLowerCase()
  return normalized === 'npx' || normalized.endsWith('/npx')
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForStableJson(value))
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) out[key] = sortForStableJson((value as Record<string, unknown>)[key])
    return out
  }
  return value
}
