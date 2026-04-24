import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { recordRewindSnapshot } from '../storage/rewind.js'
import type { Tool } from './contracts.js'
import { resolveWorkspacePath } from './Read.js'

const schema = z.object({
  path: z.string().min(1),
})

export const deleteFileTool: Tool<typeof schema> = {
  name: 'delete_file',
  kind: 'delete',
  description: 'Delete one file in the current workspace. Use this for user requests to remove a file; do not use run_bash for normal file deletion.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to delete.' },
    },
    required: ['path'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const prepared = await prepareDelete(input, context)
    return {
      kind: 'delete',
      path: prepared.fullPath,
      relativePath: prepared.relativePath,
      directoryPath: path.dirname(prepared.fullPath),
      title: 'allow file delete?',
      subtitle: prepared.fullPath,
      before: preview(prepared.before),
      after: '(deleted)',
      changeSummary: `delete ${prepared.relativePath}`,
    }
  },
  async execute(input, context) {
    const prepared = await prepareDelete(input, context)
    const rewindWarning = await tryRecordRewindSnapshot({
      workspaceRoot: context.workspaceRoot,
      filePath: prepared.fullPath,
      relativePath: prepared.relativePath,
      existedBefore: true,
      previousContent: prepared.before,
      changeSummary: `restore deleted ${prepared.relativePath}`,
      createdAt: new Date().toISOString(),
      sessionId: context.checkpoint?.sessionId,
      turnId: context.checkpoint?.turnId,
      messageRole: context.checkpoint?.messageRole,
      promptSnippet: context.checkpoint?.promptSnippet,
      checkpointLabel: context.checkpoint?.checkpointLabel,
    })
    await fs.unlink(prepared.fullPath)
    return {
      ok: true,
      summary: `deleted ${prepared.relativePath}`,
      content: rewindWarning
        ? `deleted ${prepared.fullPath}\nwarning: ${rewindWarning}`
        : `deleted ${prepared.fullPath}`,
    }
  },
}

async function prepareDelete(input: z.infer<typeof schema>, context: { workspaceRoot: string }) {
  assertSafeDeletePath(input.path)
  const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
  const stats = await fs.stat(fullPath)
  if (stats.isDirectory()) {
    throw new Error('delete_file path points to a directory; provide a file path')
  }
  const before = await fs.readFile(fullPath, 'utf8')
  return {
    fullPath,
    relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
    before,
  }
}

function assertSafeDeletePath(requestedPath: string): void {
  const trimmed = requestedPath.trim()
  if (trimmed !== requestedPath || trimmed.length === 0) {
    throw new Error('delete_file path must be a clean workspace-relative file path')
  }
  if (/[|;&<>`]/.test(trimmed)) {
    throw new Error('delete_file path must not contain shell operators')
  }
  if (/^(?:rm|del|erase|rmdir|remove-item|mkdir|type|cat|echo|copy|move|mv|cp)\b/i.test(trimmed)) {
    throw new Error('delete_file path looks like a shell command; pass only the file path')
  }
}

async function tryRecordRewindSnapshot(
  snapshot: Parameters<typeof recordRewindSnapshot>[0],
): Promise<string | undefined> {
  try {
    await recordRewindSnapshot(snapshot)
    return undefined
  } catch (error: unknown) {
    const message = (error as Error).message || 'rewind checkpoint could not be recorded'
    return `rewind checkpoint was not recorded (${message})`
  }
}

function preview(text: string, max = 1200): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
