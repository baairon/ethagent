import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '../storage/atomicWrite.js'
import { ensureConfigDir, getConfigDir } from '../storage/config.js'

export type ProjectMcpDecision = 'approved' | 'rejected'

const ProjectDecisionSchema = z.object({
  workspaceRoot: z.string().min(1),
  serverName: z.string().min(1),
  configHash: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
})

const DisabledServerSchema = z.object({
  workspaceRoot: z.string().min(1),
  serverName: z.string().min(1),
})

const McpLocalStateSchema = z.object({
  version: z.literal(1),
  projectServers: z.array(ProjectDecisionSchema),
  disabledServers: z.array(DisabledServerSchema),
})

type McpLocalState = z.infer<typeof McpLocalStateSchema>

function getMcpLocalStatePath(): string {
  return path.join(getConfigDir(), 'mcp-state.json')
}

export async function getProjectMcpDecision(params: {
  workspaceRoot: string
  serverName: string
  configHash: string
}): Promise<ProjectMcpDecision | undefined> {
  const state = await loadMcpLocalState()
  const workspaceRoot = path.resolve(params.workspaceRoot)
  return state.projectServers.find(entry =>
    path.resolve(entry.workspaceRoot) === workspaceRoot &&
    entry.serverName === params.serverName &&
    entry.configHash === params.configHash,
  )?.decision
}

export async function setProjectMcpDecision(params: {
  workspaceRoot: string
  serverName: string
  configHash: string
  decision: ProjectMcpDecision
}): Promise<void> {
  const state = await loadMcpLocalState()
  const workspaceRoot = path.resolve(params.workspaceRoot)
  const next = state.projectServers.filter(entry =>
    !(path.resolve(entry.workspaceRoot) === workspaceRoot && entry.serverName === params.serverName),
  )
  next.push({
    workspaceRoot,
    serverName: params.serverName,
    configHash: params.configHash,
    decision: params.decision,
  })
  await writeMcpLocalState({ ...state, projectServers: next })
}

export async function isMcpServerDisabled(workspaceRoot: string, serverName: string): Promise<boolean> {
  const state = await loadMcpLocalState()
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot)
  return state.disabledServers.some(entry =>
    path.resolve(entry.workspaceRoot) === normalizedWorkspaceRoot && entry.serverName === serverName,
  )
}

export async function setMcpServerEnabled(params: {
  workspaceRoot: string
  serverName: string
  enabled: boolean
}): Promise<void> {
  const state = await loadMcpLocalState()
  const workspaceRoot = path.resolve(params.workspaceRoot)
  const withoutServer = state.disabledServers.filter(entry =>
    !(path.resolve(entry.workspaceRoot) === workspaceRoot && entry.serverName === params.serverName),
  )
  const disabledServers = params.enabled
    ? withoutServer
    : [...withoutServer, { workspaceRoot, serverName: params.serverName }]
  await writeMcpLocalState({ ...state, disabledServers })
}

async function loadMcpLocalState(): Promise<McpLocalState> {
  let raw: string
  try {
    raw = await fs.readFile(getMcpLocalStatePath(), 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyState()
    throw err
  }
  try {
    return McpLocalStateSchema.parse(JSON.parse(raw))
  } catch {
    return emptyState()
  }
}

async function writeMcpLocalState(state: McpLocalState): Promise<void> {
  await ensureConfigDir()
  await atomicWriteText(getMcpLocalStatePath(), JSON.stringify(McpLocalStateSchema.parse(state), null, 2) + '\n')
}

function emptyState(): McpLocalState {
  return { version: 1, projectServers: [], disabledServers: [] }
}
