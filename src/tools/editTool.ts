import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { recordRewindSnapshot } from '../storage/rewind.js'
import type { EthagentConfig } from '../storage/config.js'
import type { Tool } from './contracts.js'
import { applyRequestedEdit } from './editUtils.js'
import { resolveWorkspacePath } from './readTool.js'

const schema = z.object({
  path: z.string().min(1),
  oldText: z.string().optional(),
  newText: z.string(),
  replaceAll: z.boolean().optional(),
  replaceWholeFile: z.boolean().optional(),
})

export const editTool: Tool<typeof schema> = {
  name: 'edit_file',
  kind: 'edit',
  description: 'Edit a workspace text file. Provide oldText and newText for targeted replacement, or just newText only for ordinary whole-file workspace edits. Do not use for private SOUL.md or MEMORY.md when an identity is linked; use propose_private_continuity_edit instead.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit.' },
      oldText: { type: 'string', description: 'Exact text to find and replace. Prefer this for existing files. Omit only for ordinary whole-file workspace edits.' },
      newText: { type: 'string', description: 'Replacement text, or entire file contents if oldText is omitted.' },
      replaceAll: { type: 'boolean', description: 'Replace every exact oldText match. Prefer false unless you are certain.' },
    },
    required: ['path', 'newText'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const { fullPath, relativePath, applied } = await prepareEdit(input, context)
    return {
      kind: 'edit',
      path: fullPath,
      relativePath,
      directoryPath: path.dirname(fullPath),
      title: 'allow file edit?',
      subtitle: fullPath,
      before: applied.previewBefore,
      after: applied.previewAfter,
      changeSummary: applied.summary,
    }
  },
  async execute(input, context) {
    const { fullPath, applied, existedBefore, before } = await prepareEdit(input, context)
    const rewindWarning = await tryRecordRewindSnapshot({
      workspaceRoot: context.workspaceRoot,
      filePath: fullPath,
      relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
      existedBefore,
      previousContent: before,
      changeSummary: applied.summary,
      createdAt: new Date().toISOString(),
      sessionId: context.checkpoint?.sessionId,
      turnId: context.checkpoint?.turnId,
      messageRole: context.checkpoint?.messageRole,
      promptSnippet: context.checkpoint?.promptSnippet,
      checkpointLabel: context.checkpoint?.checkpointLabel,
    })
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, applied.after, 'utf8')
    return {
      ok: true,
      summary: applied.summary,
      content: rewindWarning
        ? `updated ${fullPath}\nwarning: ${rewindWarning}`
        : `updated ${fullPath}`,
    }
  },
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

async function prepareEdit(input: z.infer<typeof schema>, context: { workspaceRoot: string; config?: EthagentConfig }) {
  assertSafeEditPath(input.path)
  assertNotPrivateContinuityWorkspacePath(input.path, context.config, 'edit_file')
  const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
  await assertEditableFileTarget(fullPath)
  const { content: before, existed } = await readOptionalTextFile(fullPath)
  const applied = applyRequestedEdit(
    input.path,
    before,
    input.oldText,
    input.newText,
    input.replaceAll ?? false,
    input.replaceWholeFile ?? false,
  )
  return {
    fullPath,
    relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
    existedBefore: existed,
    before,
    applied,
  }
}

async function assertEditableFileTarget(fullPath: string): Promise<void> {
  try {
    const stats = await fs.stat(fullPath)
    if (stats.isDirectory()) {
      throw new Error('edit_file path points to a directory; provide a file path')
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
}

function assertSafeEditPath(requestedPath: string): void {
  const trimmed = requestedPath.trim()
  if (trimmed !== requestedPath || trimmed.length === 0) {
    throw new Error('edit_file path must be a clean workspace-relative file path')
  }

  if (/[|;&<>`]/.test(trimmed)) {
    throw new Error('edit_file path must not contain shell operators')
  }

  if (/^(?:rm|del|erase|rmdir|remove-item|mkdir|type|cat|echo|copy|move|mv|cp)\b/i.test(trimmed)) {
    throw new Error('edit_file path looks like a shell command; pass only the file path')
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

async function readOptionalTextFile(fullPath: string): Promise<{ content: string; existed: boolean }> {
  try {
    return { content: await fs.readFile(fullPath, 'utf8'), existed: true }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', existed: false }
    throw error
  }
}
