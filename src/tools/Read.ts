import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import type { Tool } from './contracts.js'

const schema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
})

export const readTool: Tool<typeof schema> = {
  name: 'read_file',
  kind: 'read',
  description: 'Read a text file from the current workspace. Use startLine and endLine to limit the range when the file is large.',
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read.' },
      startLine: { type: 'number', description: 'Optional 1-based starting line.' },
      endLine: { type: 'number', description: 'Optional 1-based ending line.' },
    },
    required: ['path'],
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
    const relativePath = path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath)
    return {
      kind: 'read',
      path: fullPath,
      relativePath,
      directoryPath: path.dirname(fullPath),
      title: 'allow file read?',
      subtitle: input.startLine || input.endLine
        ? `${fullPath} · lines ${input.startLine ?? 1}-${input.endLine ?? 'end'}`
        : fullPath,
    }
  },
  async execute(input, context) {
    const fullPath = resolveWorkspacePath(context.workspaceRoot, input.path)
    const raw = await fs.readFile(fullPath, 'utf8')
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
    const start = Math.max(1, input.startLine ?? 1)
    const end = Math.max(start, input.endLine ?? lines.length)
    const slice = lines.slice(start - 1, end)
    const numbered = slice.map((line, i) => `${start + i}: ${line}`).join('\n')
    return {
      ok: true,
      summary: `read ${path.relative(context.workspaceRoot, fullPath) || path.basename(fullPath)}`,
      content: numbered,
    }
  },
}

export function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const expandedPath = requestedPath.startsWith('~')
    ? path.join(os.homedir(), requestedPath.slice(1))
    : requestedPath
  const fullPath = path.resolve(workspaceRoot, expandedPath)
  const rel = path.relative(workspaceRoot, fullPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${requestedPath}`)
  }
  return fullPath
}
