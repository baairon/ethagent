import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Tool } from './contracts.js'
import { resolveWorkspacePath } from './readTool.js'

const schema = z.object({
  path: z.string().optional(),
})

export const listDirectoryTool: Tool<typeof schema> = {
  name: 'list_directory',
  kind: 'read',
  description: 'List files and folders in the current workspace. Use this first when you need to discover existing files before reading or editing them.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Optional directory path relative to the current workspace.' },
    },
    required: [],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path ?? '.')
    const relativePath = path.relative(context.workspaceRoot, fullPath) || '.'
    return {
      kind: 'read',
      path: fullPath,
      relativePath,
      directoryPath: fullPath,
      title: 'allow directory listing?',
      subtitle: fullPath,
    }
  },
  async execute(input, context) {
    const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path ?? '.')
    const entries = await fs.readdir(fullPath, { withFileTypes: true })
    const lines = entries
      .sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) return -1
        if (!left.isDirectory() && right.isDirectory()) return 1
        return left.name.localeCompare(right.name)
      })
      .map(entry => `${entry.isDirectory() ? '[dir]' : '     '} ${entry.name}`)
    const relativePath = path.relative(context.workspaceRoot, fullPath) || '.'
    return {
      ok: true,
      summary: `listed ${relativePath}`,
      content: lines.length > 0 ? lines.join('\n') : '(empty directory)',
    }
  },
}
