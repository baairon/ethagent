import { z } from 'zod'
import type { Tool } from './contracts.js'
import { normalizeNameForMcp } from '../mcp/names.js'

const ListMcpResourcesInput = z.object({
  server: z.string().min(1).optional(),
})

const ReadMcpResourceInput = z.object({
  server: z.string().min(1),
  uri: z.string().min(1),
})

export const listMcpResourcesTool: Tool<typeof ListMcpResourcesInput> = {
  name: 'list_mcp_resources',
  kind: 'mcp',
  readOnly: true,
  description: 'List resources exposed by connected MCP servers.',
  inputSchema: ListMcpResourcesInput,
  inputSchemaJson: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'Optional MCP server name. Omit to list resources from every connected server.' },
    },
  },
  parse(input) {
    return ListMcpResourcesInput.parse(input)
  },
  async buildPermissionRequest(input) {
    const serverName = input.server ?? '*'
    return {
      kind: 'mcp',
      title: 'allow MCP resource listing?',
      subtitle: input.server ? `list resources from ${input.server}` : 'list resources from all connected MCP servers',
      serverName,
      normalizedServerName: normalizeNameForMcp(serverName),
      toolName: 'list_mcp_resources',
      toolKey: 'list_mcp_resources',
      readOnly: true,
      destructive: false,
      openWorld: false,
      canPersistServer: Boolean(input.server),
    }
  },
  async execute(input, context) {
    if (!context.mcp) return { ok: false, summary: 'MCP unavailable', content: 'MCP runtime is not available.' }
    return {
      ok: true,
      summary: input.server ? `listed MCP resources from ${input.server}` : 'listed MCP resources',
      content: await context.mcp.listResources(input.server),
    }
  },
}

export const readMcpResourceTool: Tool<typeof ReadMcpResourceInput> = {
  name: 'read_mcp_resource',
  kind: 'mcp',
  readOnly: true,
  description: 'Read a specific resource from a connected MCP server.',
  inputSchema: ReadMcpResourceInput,
  inputSchemaJson: {
    type: 'object',
    properties: {
      server: { type: 'string', description: 'The connected MCP server name.' },
      uri: { type: 'string', description: 'The resource URI to read.' },
    },
    required: ['server', 'uri'],
  },
  parse(input) {
    return ReadMcpResourceInput.parse(input)
  },
  async buildPermissionRequest(input) {
    return {
      kind: 'mcp',
      title: 'allow MCP resource read?',
      subtitle: `${input.server} / ${input.uri}`,
      serverName: input.server,
      normalizedServerName: normalizeNameForMcp(input.server),
      toolName: 'read_mcp_resource',
      toolKey: `read_mcp_resource:${normalizeNameForMcp(input.server)}`,
      readOnly: true,
      destructive: false,
      openWorld: false,
      canPersistServer: true,
    }
  },
  async execute(input, context) {
    if (!context.mcp) return { ok: false, summary: 'MCP unavailable', content: 'MCP runtime is not available.' }
    return {
      ok: true,
      summary: `read MCP resource ${input.uri}`,
      content: await context.mcp.readResource(input.server, input.uri, context.abortSignal),
    }
  },
}
