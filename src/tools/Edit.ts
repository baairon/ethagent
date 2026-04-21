import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { recordRewindSnapshot } from '../storage/rewind.js'
import type { Tool } from './contracts.js'
import { applyRequestedEdit } from './editUtils.js'
import { resolveWorkspacePath } from './Read.js'

const schema = z.object({
  path: z.string().min(1),
  oldText: z.string().optional(),
  newText: z.string(),
  replaceAll: z.boolean().optional(),
})

export const editTool: Tool<typeof schema> = {
  name: 'edit_file',
  kind: 'edit',
  description: 'Edit a text file in the current workspace. Prefer replacing a specific oldText snippet with newText. If oldText is omitted, the file is fully replaced.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit.' },
      oldText: { type: 'string', description: 'Existing text to replace. Omit to replace the entire file.' },
      newText: { type: 'string', description: 'Replacement text.' },
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
    await recordRewindSnapshot({
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
      content: `updated ${fullPath}`,
    }
  },
}

async function prepareEdit(input: z.infer<typeof schema>, context: { workspaceRoot: string }) {
  const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
  const { content: before, existed } = await readOptionalTextFile(fullPath)
  const applied = applyRequestedEdit(input.path, before, input.oldText, input.newText, input.replaceAll ?? false)
  return {
    fullPath,
    relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
    existedBefore: existed,
    before,
    applied,
  }
}

async function readOptionalTextFile(fullPath: string): Promise<{ content: string; existed: boolean }> {
  try {
    return { content: await fs.readFile(fullPath, 'utf8'), existed: true }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: '', existed: false }
    throw error
  }
}
