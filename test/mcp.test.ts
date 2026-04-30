import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadMcpConfigs } from '../src/mcp/config.js'
import { McpManager, type McpSnapshot } from '../src/mcp/manager.js'
import { formatMcpCallResult } from '../src/mcp/output.js'
import { executeToolWithPermissions } from '../src/runtime/toolExecution.js'
import type { PermissionRequest } from '../src/tools/contracts.js'

test('MCP config loads project servers with environment expansion', async () => {
  await withTempHome(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mcp-config-'))
    process.env.ETHAGENT_MCP_ARG = 'expanded'
    await fs.writeFile(path.join(cwd, '.mcp.json'), JSON.stringify({
      mcpServers: {
        demo: {
          type: 'stdio',
          command: process.execPath,
          args: ['${ETHAGENT_MCP_ARG}', '${ETHAGENT_MCP_MISSING:-fallback}'],
        },
      },
    }), 'utf8')

    const loaded = await loadMcpConfigs(cwd)
    assert.equal(loaded.issues.length, 0)
    assert.equal(loaded.servers.length, 1)
    assert.equal(loaded.servers[0]?.scope, 'project')
    assert.deepEqual('args' in loaded.servers[0]!.config ? loaded.servers[0]!.config.args : [], ['expanded', 'fallback'])
  })
})

test('MCP manager prompts for project approval before connecting, then exposes tools/resources/prompts', async () => {
  await withTempHome(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mcp-manager-'))
    const serverFile = await writeMockMcpServer(cwd)
    let snapshot: McpSnapshot | undefined
    const manager = new McpManager(cwd, next => { snapshot = next })
    try {
      const json = JSON.stringify({ type: 'stdio', command: process.execPath, args: [serverFile] })
      assert.match(await manager.addJson('demo', json, 'project'), /added MCP server "demo"/)
      assert.equal(snapshot?.servers[0]?.status, 'pending')
      assert.equal(manager.getTools().length, 0)

      assert.match(await manager.approveServer('demo'), /approved MCP project server "demo"/)
      assert.equal(snapshot?.servers[0]?.status, 'connected')
      assert.equal(snapshot?.servers[0]?.tools, 1)
      assert.equal(snapshot?.servers[0]?.resources, 1)
      assert.equal(snapshot?.servers[0]?.prompts, 1)
      assert.equal(manager.getTools()[0]?.name, 'mcp__demo__echo')

      let seenRequest: PermissionRequest | undefined
      const outcome = await executeToolWithPermissions({
        name: 'mcp__demo__echo',
        input: { text: 'hello' },
        permissionMode: 'default',
        cwd,
        dynamicTools: manager.getTools(),
        mcp: manager,
        getPermissionRules: () => [],
        requestPermission: async request => {
          seenRequest = request
          return 'allow-once'
        },
        onDirectoryChange: () => {},
      })
      assert.equal(outcome.result.ok, true)
      assert.match(outcome.result.content, /echo: hello/)
      assert.equal(seenRequest?.kind, 'mcp')
      if (seenRequest?.kind === 'mcp') {
        assert.equal(seenRequest.toolKey, 'mcp__demo__echo')
        assert.equal(seenRequest.readOnly, true)
      }

      assert.match(await manager.listResources('demo'), /memory:\/\/note/)
      assert.match(await manager.readResource('demo', 'memory://note'), /resource body/)
      const promptText = await manager.runPromptSlash('mcp__demo__ask', 'topic=wallet')
      assert.notEqual(promptText, null)
      assert.match(promptText!, /Write about wallet/)
    } finally {
      await manager.close()
    }
  })
})

test('MCP tool schema validation rejects invalid input before remote execution', async () => {
  await withTempHome(async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mcp-invalid-'))
    const serverFile = await writeMockMcpServer(cwd)
    const manager = new McpManager(cwd, () => {})
    try {
      await manager.addJson('demo', JSON.stringify({ type: 'stdio', command: process.execPath, args: [serverFile] }), 'project')
      await manager.approveServer('demo')
      const outcome = await executeToolWithPermissions({
        name: 'mcp__demo__echo',
        input: {},
        permissionMode: 'default',
        cwd,
        dynamicTools: manager.getTools(),
        mcp: manager,
        getPermissionRules: () => [],
        requestPermission: async () => 'allow-once',
        onDirectoryChange: () => {},
      })
      assert.equal(outcome.result.ok, false)
      assert.match(outcome.result.content, /schema validation/i)
    } finally {
      await manager.close()
    }
  })
})

test('MCP output annotates upstream search rate-limit errors without blaming transport', () => {
  const formatted = formatMcpCallResult({
    isError: true,
    content: [{
      type: 'text',
      text: 'Error: DDG detected an anomaly in the request, you are likely making requests too quickly.',
    }],
  })

  assert.equal(formatted.ok, false)
  assert.match(formatted.content, /DDG detected an anomaly/)
  assert.match(formatted.content, /upstream rate-limit or anti-abuse error/)
  assert.match(formatted.content, /MCP transport is still connected/)
})

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prevHome = process.env.HOME
  const prevUserProfile = process.env.USERPROFILE
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ethagent-mcp-home-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    await fn()
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    await fs.rm(home, { recursive: true, force: true })
  }
}

async function writeMockMcpServer(cwd: string): Promise<string> {
  const file = path.join(cwd, 'mock-mcp-server.mjs')
  const sdkBase = pathToFileURL(path.resolve('node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm')).href
  await fs.writeFile(file, `
const { Server } = await import('${sdkBase}/server/index.js')
const { StdioServerTransport } = await import('${sdkBase}/server/stdio.js')
const {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} = await import('${sdkBase}/types.js')

const server = new Server(
  { name: 'mock-mcp', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'echo',
    description: 'Echo text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{ type: 'text', text: 'echo: ' + request.params.arguments.text }],
}))

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: 'memory://note', name: 'note', mimeType: 'text/plain' }],
}))

server.setRequestHandler(ReadResourceRequestSchema, async request => ({
  contents: [{ uri: request.params.uri, text: 'resource body', mimeType: 'text/plain' }],
}))

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: 'ask', description: 'Ask prompt', arguments: [{ name: 'topic', required: true }] }],
}))

server.setRequestHandler(GetPromptRequestSchema, async request => ({
  messages: [{ role: 'user', content: { type: 'text', text: 'Write about ' + request.params.arguments.topic } }],
}))

await server.connect(new StdioServerTransport())
`, 'utf8')
  return file
}
