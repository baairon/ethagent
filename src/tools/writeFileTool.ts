import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { recordRewindSnapshot } from '../storage/rewind.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Tool } from './contracts.js'
import { resolveWorkspacePath } from './readTool.js'

const schema = z.object({
  path: z.string().min(1),
  content: z.string(),
  overwrite: z.boolean().optional(),
})

export const writeFileTool: Tool<typeof schema> = {
  name: 'write_file',
  kind: 'write',
  description: 'Create a new text file, or replace an entire existing file only when overwrite is true. Prefer edit_file for targeted changes to existing files.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path to write.' },
      content: { type: 'string', description: 'Complete file contents to write.' },
      overwrite: { type: 'boolean', description: 'Set true only when intentionally replacing an existing file.' },
    },
    required: ['path', 'content'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const prepared = await prepareWrite(input, context)
    return {
      kind: 'write',
      path: prepared.fullPath,
      relativePath: prepared.relativePath,
      directoryPath: path.dirname(prepared.fullPath),
      title: prepared.existedBefore ? 'allow file rewrite?' : 'allow file creation?',
      subtitle: prepared.fullPath,
      before: previewText(prepared.before),
      after: previewText(input.content),
      changeSummary: prepared.existedBefore ? `replace entire ${prepared.relativePath}` : `create ${prepared.relativePath}`,
    }
  },
  async execute(input, context) {
    const prepared = await prepareWrite(input, context)
    const rewindWarning = await tryRecordRewindSnapshot({
      workspaceRoot: context.workspaceRoot,
      filePath: prepared.fullPath,
      relativePath: prepared.relativePath,
      existedBefore: prepared.existedBefore,
      previousContent: prepared.before,
      changeSummary: prepared.existedBefore ? `replace entire ${prepared.relativePath}` : `create ${prepared.relativePath}`,
      createdAt: new Date().toISOString(),
      sessionId: context.checkpoint?.sessionId,
      turnId: context.checkpoint?.turnId,
      messageRole: context.checkpoint?.messageRole,
      promptSnippet: context.checkpoint?.promptSnippet,
      checkpointLabel: context.checkpoint?.checkpointLabel,
    })
    await fs.mkdir(path.dirname(prepared.fullPath), { recursive: true })
    await fs.writeFile(prepared.fullPath, input.content, 'utf8')
    return {
      ok: true,
      summary: prepared.existedBefore ? `replace entire ${prepared.relativePath}` : `create ${prepared.relativePath}`,
      content: rewindWarning
        ? `updated ${prepared.fullPath}\nwarning: ${rewindWarning}`
        : `updated ${prepared.fullPath}`,
    }
  },
}

async function prepareWrite(
  input: z.infer<typeof schema>,
  context: { workspaceRoot: string; config?: EthagentConfig },
) {
  assertSafeWritePath(input.path)
  assertNotPrivateContinuityWorkspacePath(input.path, context.config, 'write_file')
  if (input.content.length === 0) {
    throw new Error('write_file content is empty; provide non-empty file contents')
  }

  const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
  const relativePath = path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath)
  const { before, existedBefore } = await readExistingFile(fullPath)

  return { fullPath, relativePath, before, existedBefore }
}

async function readExistingFile(fullPath: string): Promise<{ before: string; existedBefore: boolean }> {
  try {
    const stats = await fs.stat(fullPath)
    if (stats.isDirectory()) throw new Error('write_file path points to a directory; provide a file path')
    return { before: await fs.readFile(fullPath, 'utf8'), existedBefore: true }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { before: '', existedBefore: false }
    throw error
  }
}

async function tryRecordRewindSnapshot(
  snapshot: Parameters<typeof recordRewindSnapshot>[0],
): Promise<string | undefined> {
  try {
    await recordRewindSnapshot(snapshot)
    return undefined
  } catch (error: unknown) {
    return `rewind checkpoint was not recorded (${(error as Error).message || 'unknown error'})`
  }
}

function assertSafeWritePath(requestedPath: string): void {
  const trimmed = requestedPath.trim()
  if (trimmed !== requestedPath || trimmed.length === 0) {
    throw new Error('write_file path must be a clean workspace-relative file path')
  }
  if (/[|;&<>`]/.test(trimmed)) {
    throw new Error('write_file path must not contain shell operators')
  }
  if (/^(?:rm|del|erase|rmdir|remove-item|mkdir|type|cat|echo|copy|move|mv|cp)\b/i.test(trimmed)) {
    throw new Error('write_file path looks like a shell command; pass only the file path')
  }
}

function assertNotPrivateContinuityWorkspacePath(
  requestedPath: string,
  config: EthagentConfig | undefined,
  toolName: string,
): void {
  if (!config?.identity) return
  const basename = path.basename(requestedPath.replaceAll('\\', '/')).toUpperCase()
  if (basename !== 'SOUL.MD' && basename !== 'MEMORY.MD') return
  throw new Error(
    `${toolName} must not create or overwrite ${basename}; use propose_private_continuity_edit to patch the existing identity-vault scaffold`,
  )
}

function previewText(text: string, max = 700): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 3)}...`
}
