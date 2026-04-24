import { getTool } from '../tools/registry.js'
import {
  buildPermissionRule,
  matchPermissionRule,
  shouldPersistPermissionDecision,
} from '../tools/permissionRules.js'
import { ZodError } from 'zod'
import type {
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  SessionPermissionRule,
  ToolExecutionContext,
  ToolResult,
} from '../tools/contracts.js'
import { setCwd as setRuntimeCwd } from './cwd.js'
import { modePolicy } from './modePolicy.js'
import type { EthagentConfig } from '../storage/config.js'
import type { SessionMessage } from '../storage/sessions.js'
import {
  summarizeToolInput,
  truncateForRow,
} from '../ui/chatScreenUtils.js'
import type { MessageRow } from '../ui/MessageList.js'
import { toPermissionMode, type SessionMode } from './sessionMode.js'

// ---------------------------------------------------------------------------
// Tool execution with permission gating
// ---------------------------------------------------------------------------

export type ToolExecutorOptions = {
  name: string
  input: Record<string, unknown>
  permissionMode: PermissionMode
  cwd: string
  abortSignal?: AbortSignal
  checkpoint?: ToolExecutionContext['checkpoint']
  getPermissionRules: () => SessionPermissionRule[]
  requestPermission: (request: PermissionRequest) => Promise<PermissionDecision>
  onDirectoryChange: (next: string) => void
}

export type ToolExecutionOutcome = {
  result: ToolResult
  sessionRule?: SessionPermissionRule
  persistRule?: boolean
}

export async function executeToolWithPermissions(
  options: ToolExecutorOptions,
): Promise<ToolExecutionOutcome> {
  const tool = getTool(options.name)
  if (!tool) {
    return {
      result: {
        ok: false,
        summary: `unknown tool ${options.name}`,
        content: `tool '${options.name}' is not registered`,
      },
    }
  }

  let parsedInput: ReturnType<typeof tool.parse>
  try {
    parsedInput = tool.parse(options.input)
  } catch (err: unknown) {
    return {
      result: {
        ok: false,
        summary: `${options.name} rejected input`,
        content: formatToolParseError(err),
      },
    }
  }

  const context: ToolExecutionContext = {
    workspaceRoot: options.cwd,
    abortSignal: options.abortSignal,
    checkpoint: options.checkpoint,
    changeDirectory: next => {
      const updated = setRuntimeCwd(next, options.cwd)
      options.onDirectoryChange(updated)
    },
  }

  let request: PermissionRequest
  try {
    request = await tool.buildPermissionRequest(parsedInput, context)
  } catch (err: unknown) {
    return {
      result: {
        ok: false,
        summary: `${options.name} failed before execution`,
        content: (err as Error).message,
      },
    }
  }

  if (options.permissionMode === 'plan' && request.kind !== 'read') {
    return {
      result: {
        ok: false,
        summary: `${options.name} blocked in plan mode`,
        content: 'plan mode allows inspection only. switch modes before changing files, directories, or running shell commands.',
      },
    }
  }

  const matchedRule = matchPermissionRule(options.getPermissionRules(), request)
  const decision: PermissionDecision =
    modePolicy(options.permissionMode).autoAllowToolKind(request.kind)
      ? 'allow-once'
      : matchedRule
        ? 'allow-once'
        : await options.requestPermission(request)

  if (decision === 'deny') {
    return {
      result: {
        ok: false,
        summary: `${options.name} denied`,
        content: 'tool use denied by the user',
      },
    }
  }

  const rule = buildPermissionRule(decision, request)
  const persistRule = shouldPersistPermissionDecision(decision)

  try {
    const result = await tool.execute(parsedInput, context)
    return { result, sessionRule: rule, persistRule }
  } catch (err: unknown) {
    return {
      result: {
        ok: false,
        summary: `${options.name} failed`,
        content: (err as Error).message || 'tool execution failed',
      },
      sessionRule: rule,
      persistRule,
    }
  }
}

function formatToolParseError(err: unknown): string {
  if (err instanceof ZodError) {
    const missing: string[] = []
    const invalid: string[] = []

    for (const issue of err.issues) {
      const field = issue.path.join('.') || 'input'
      if (issue.code === 'invalid_type' && issue.received === 'undefined') {
        missing.push(field)
      } else {
        invalid.push(`${field}: ${issue.message}`)
      }
    }

    const parts: string[] = []
    if (missing.length > 0) parts.push(`missing required fields: ${missing.join(', ')}`)
    if (invalid.length > 0) parts.push(`invalid fields: ${invalid.join('; ')}`)
    return parts.join('\n') || 'tool input did not match the required schema'
  }

  return (err as Error).message || 'tool input did not match the required schema'
}

// ---------------------------------------------------------------------------
// Pending tool-use runner (per turn)
// ---------------------------------------------------------------------------

export type PendingToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type CompletedToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
  result: ToolResult
  cwd: string
}

type ExecuteToolResult = {
  result: ToolResult
  sessionRule?: SessionPermissionRule
  persistRule?: boolean
}

export type ToolUseRunnerResult = {
  cancelled: boolean
  completedTools: CompletedToolUse[]
}

export async function runPendingToolUses(args: {
  pendingToolUses: PendingToolUse[]
  nextRowId: () => string
  nowIso: () => string
  mode: SessionMode
  getCwd: () => string
  getConfig: () => EthagentConfig
  turnId?: string
  controller: AbortController
  updateRows: (updater: (prev: MessageRow[]) => MessageRow[]) => void
  pushNote: (text: string, kind?: 'info' | 'error' | 'dim') => void
  persistTurnMessage: (message: SessionMessage) => Promise<void>
  executeTool: (
    name: string,
    input: Record<string, unknown>,
    mode: ReturnType<typeof toPermissionMode>,
  ) => Promise<ExecuteToolResult>
  applySessionRule: (rule?: SessionPermissionRule, persistRule?: boolean) => Promise<void>
}): Promise<ToolUseRunnerResult> {
  const completedTools: CompletedToolUse[] = []

  for (const toolUse of args.pendingToolUses) {
    args.updateRows(prev => [
      ...prev,
      { role: 'tool_use', id: args.nextRowId(), name: toolUse.name, summary: toolUse.name, input: summarizeToolInput(toolUse.input) },
    ])
    await args.persistTurnMessage({
      version: 2,
      role: 'tool_use',
      toolUseId: toolUse.id,
      name: toolUse.name,
      input: toolUse.input,
      createdAt: args.nowIso(),
      turnId: args.turnId,
    })

    const cwd = args.getCwd()
    const { result, sessionRule, persistRule } = await args.executeTool(
      toolUse.name,
      toolUse.input,
      toPermissionMode(args.mode),
    )
    completedTools.push({ ...toolUse, result, cwd })

    if (args.controller.signal.aborted) {
      return { cancelled: true, completedTools }
    }

    await args.applySessionRule(sessionRule, persistRule)
    await recordToolResult(args, toolUse, result)
  }

  return { cancelled: false, completedTools }
}

async function recordToolResult(
  args: Pick<
    Parameters<typeof runPendingToolUses>[0],
    'nextRowId' | 'nowIso' | 'turnId' | 'updateRows' | 'persistTurnMessage'
  >,
  toolUse: PendingToolUse,
  result: ToolResult,
): Promise<void> {
  args.updateRows(prev => [
    ...prev,
    {
      role: 'tool_result',
      id: args.nextRowId(),
      name: toolUse.name,
      summary: result.summary,
      content: truncateForRow(result.content),
      isError: !result.ok,
    },
  ])
  await args.persistTurnMessage({
    version: 2,
    role: 'tool_result',
    toolUseId: toolUse.id,
    name: toolUse.name,
    content: result.content,
    isError: !result.ok,
    createdAt: args.nowIso(),
    turnId: args.turnId,
  })
}
