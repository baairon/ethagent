import { z } from 'zod'
import type { EthagentConfig } from '../storage/config.js'

import type { McpRuntime } from '../mcp/manager.js'

export type ToolKind = 'read' | 'write' | 'edit' | 'delete' | 'bash' | 'cd' | 'private-continuity-read' | 'private-continuity-edit' | 'mcp'

export type PermissionRequest =
  | {
      kind: 'read'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
    }
  | {
      kind: 'write'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
      before: string
      after: string
      changeSummary: string
    }
  | {
      kind: 'edit'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
      before: string
      after: string
      changeSummary: string
    }
  | {
      kind: 'private-continuity-read'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
      file: 'SOUL.md' | 'MEMORY.md'
      range: string
    }
  | {
      kind: 'private-continuity-edit'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
      file: 'SOUL.md' | 'MEMORY.md'
      before: string
      after: string
      diff: string
      changeSummary: string
    }
  | {
      kind: 'delete'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
      before: string
      after: string
      changeSummary: string
    }
  | {
      kind: 'bash'
      command: string
      commandPrefix: string
      cwd: string
      title: string
      subtitle: string
      warning?: string
      canPersistExact: boolean
      canPersistPrefix: boolean
    }
  | {
      kind: 'mcp'
      title: string
      subtitle: string
      serverName: string
      normalizedServerName: string
      toolName: string
      toolKey: string
      readOnly: boolean
      destructive: boolean
      openWorld: boolean
      canPersistServer: boolean
    }
  | {
      kind: 'cd'
      path: string
      relativePath: string
      directoryPath: string
      title: string
      subtitle: string
    }

export type PermissionMode = 'default' | 'plan' | 'accept-edits'

export const SessionPermissionRuleSchema = z.union([
  z.object({ kind: z.literal('read'), scope: z.literal('kind') }),
  z.object({ kind: z.literal('read'), scope: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('read'), scope: z.literal('directory'), path: z.string().min(1) }),
  z.object({ kind: z.literal('edit'), scope: z.literal('kind') }),
  z.object({ kind: z.literal('edit'), scope: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('edit'), scope: z.literal('directory'), path: z.string().min(1) }),
  z.object({ kind: z.literal('write'), scope: z.literal('kind') }),
  z.object({ kind: z.literal('write'), scope: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('write'), scope: z.literal('directory'), path: z.string().min(1) }),
  z.object({ kind: z.literal('delete'), scope: z.literal('kind') }),
  z.object({ kind: z.literal('delete'), scope: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('delete'), scope: z.literal('directory'), path: z.string().min(1) }),
  z.object({ kind: z.literal('cd'), scope: z.literal('kind') }),
  z.object({ kind: z.literal('cd'), scope: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('cd'), scope: z.literal('directory'), path: z.string().min(1) }),
  z.object({ kind: z.literal('bash'), scope: z.literal('command'), command: z.string().min(1), cwd: z.string().min(1) }),
  z.object({ kind: z.literal('bash'), scope: z.literal('prefix'), commandPrefix: z.string().min(1), cwd: z.string().min(1) }),
  z.object({ kind: z.literal('mcp'), scope: z.literal('tool'), toolKey: z.string().min(1) }),
  z.object({ kind: z.literal('mcp'), scope: z.literal('server'), normalizedServerName: z.string().min(1) }),
])

export type SessionPermissionRule = z.infer<typeof SessionPermissionRuleSchema>

export type PermissionDecision =
  | 'allow-once'
  | 'allow-kind-project'
  | 'allow-path-project'
  | 'allow-directory-project'
  | 'allow-command-project'
  | 'allow-command-prefix-project'
  | 'allow-mcp-tool-project'
  | 'allow-mcp-server-project'
  | 'deny'

export type ToolResult =
  | { ok: true; summary: string; content: string }
  | { ok: false; summary: string; content: string }

export type ToolExecutionContext = {
  workspaceRoot: string
  config?: EthagentConfig
  abortSignal?: AbortSignal
  mcp?: McpRuntime
  changeDirectory?: (next: string) => void
  checkpoint?: {
    sessionId: string
    turnId: string
    messageRole: 'user'
    promptSnippet: string
    checkpointLabel: string
  }
}

export type Tool<Input extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string
  kind: ToolKind
  description: string
  inputSchema: Input
  inputSchemaJson: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    oneOf?: Array<Record<string, unknown>>
    anyOf?: Array<Record<string, unknown>>
    additionalProperties?: boolean
  }
  readOnly?: boolean
  parse(input: Record<string, unknown>): z.infer<Input>
  buildPermissionRequest(input: z.infer<Input>, context: ToolExecutionContext): Promise<PermissionRequest>
  execute(input: z.infer<Input>, context: ToolExecutionContext): Promise<ToolResult>
}
