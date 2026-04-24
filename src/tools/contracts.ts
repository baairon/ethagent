import { z } from 'zod'

export type ToolKind = 'read' | 'write' | 'edit' | 'delete' | 'bash' | 'cd'

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
])

export type SessionPermissionRule = z.infer<typeof SessionPermissionRuleSchema>

export type PermissionDecision =
  | 'allow-once'
  | 'allow-kind-project'
  | 'allow-path-project'
  | 'allow-directory-project'
  | 'allow-command-project'
  | 'allow-command-prefix-project'
  | 'deny'

export type ToolResult =
  | { ok: true; summary: string; content: string }
  | { ok: false; summary: string; content: string }

export type ToolExecutionContext = {
  workspaceRoot: string
  abortSignal?: AbortSignal
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
  }
  parse(input: Record<string, unknown>): z.infer<Input>
  buildPermissionRequest(input: z.infer<Input>, context: ToolExecutionContext): Promise<PermissionRequest>
  execute(input: z.infer<Input>, context: ToolExecutionContext): Promise<ToolResult>
}
