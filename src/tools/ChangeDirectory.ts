import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Tool } from './contracts.js'
import { resolveDirectoryIntent } from '../runtime/directoryIntent.js'

const schema = z.object({
  path: z.string().min(1),
})

export const changeDirectoryTool: Tool<typeof schema> = {
  name: 'change_directory',
  kind: 'cd',
  description: 'Change the current working directory for subsequent tool use.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Target directory path. May be relative to the current workspace or begin with ~.' },
    },
    required: ['path'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const fullPath = resolveTargetDirectory(context.workspaceRoot, input.path)
    return {
      kind: 'cd',
      path: fullPath,
      relativePath: path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath),
      directoryPath: path.dirname(fullPath),
      title: 'allow directory change?',
      subtitle: fullPath,
    }
  },
  async execute(input, context) {
    const fullPath = resolveTargetDirectory(context.workspaceRoot, input.path)
    const stat = await fs.stat(fullPath)
    if (!stat.isDirectory()) throw new Error(`not a directory: ${input.path}`)
    context.changeDirectory?.(fullPath)
    return {
      ok: true,
      summary: `changed directory to ${fullPath}`,
      content: fullPath,
    }
  },
}

function resolveTargetDirectory(workspaceRoot: string, requestedPath: string): string {
  return resolveDirectoryIntent(requestedPath, workspaceRoot)
}
