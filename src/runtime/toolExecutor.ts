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
    options.permissionMode === 'accept-edits' && (request.kind === 'read' || request.kind === 'edit')
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
