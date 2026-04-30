import path from 'node:path'
import { z } from 'zod'
import {
  continuityVaultRef,
  ensureContinuityFiles,
  type PrivateContinuityFile,
} from '../identity/continuity/storage.js'
import type { Tool } from './contracts.js'

const schema = z.object({
  file: z.preprocess(normalizePrivateContinuityFile, z.enum(['SOUL.md', 'MEMORY.md'])),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
})

export const privateContinuityReadTool: Tool<typeof schema> = {
  name: 'read_private_continuity_file',
  kind: 'private-continuity-read',
  description: [
    'Read an explicitly user-approved private identity continuity file from the identity vault.',
    'Only SOUL.md and MEMORY.md are valid targets; do not use workspace read_file for these files.',
    'Use this before surgical removals or targeted replacements that need exact oldText.',
    'Pass file as SOUL.md or MEMORY.md; this tool resolves the vault path.',
    'Use startLine and endLine to limit the returned range when possible.',
  ].join(' '),
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      file: { type: 'string', enum: ['SOUL.md', 'MEMORY.md'], description: 'Private continuity file to read. Use only the file name; do not pass a workspace path.' },
      startLine: { type: 'number', description: 'Optional 1-based starting line.' },
      endLine: { type: 'number', description: 'Optional 1-based ending line.' },
    },
    required: ['file'],
    additionalProperties: false,
  },
  parse(input) {
    return schema.parse(normalizePrivateContinuityReadInput(input))
  },
  async buildPermissionRequest(input, context) {
    const prepared = preparePrivateContinuityRead(input, context.config)
    return {
      kind: 'private-continuity-read',
      path: prepared.fullPath,
      relativePath: prepared.relativePath,
      directoryPath: prepared.directoryPath,
      title: 'allow private continuity read?',
      subtitle: input.startLine || input.endLine
        ? `${prepared.fullPath} - lines ${input.startLine ?? 1}-${input.endLine ?? 'end'}`
        : prepared.fullPath,
      file: input.file,
      range: input.startLine || input.endLine
        ? `lines ${input.startLine ?? 1}-${input.endLine ?? 'end'}`
        : 'entire file',
    }
  },
  async execute(input, context) {
    const prepared = preparePrivateContinuityRead(input, context.config)
    const files = await ensureContinuityFiles(prepared.identity)
    return {
      ok: true,
      summary: `read private ${input.file}`,
      content: numberedLineSlice(files[input.file], input.startLine, input.endLine),
    }
  },
}

function preparePrivateContinuityRead(
  input: z.infer<typeof schema>,
  config: Parameters<Tool['buildPermissionRequest']>[1]['config'],
) {
  const identity = config?.identity
  if (!identity) {
    throw new Error('no active identity; create or load an identity before reading private continuity files')
  }
  const ref = continuityVaultRef(identity)
  const fullPath = input.file === 'SOUL.md' ? ref.soulPath : ref.memoryPath
  return {
    identity,
    fullPath,
    relativePath: `identity-vault/${input.file}`,
    directoryPath: path.dirname(fullPath),
  }
}

function numberedLineSlice(content: string, startLine?: number, endLine?: number): string {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const start = Math.max(1, startLine ?? 1)
  const end = Math.max(start, endLine ?? lines.length)
  return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n')
}

function normalizePrivateContinuityReadInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input }
  if (normalized.file === undefined) {
    normalized.file = normalized.path ?? normalized.name
  }
  return normalized
}

function normalizePrivateContinuityFile(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const basename = path.basename(value.replaceAll('\\', '/')).trim()
  if (/^soul\.md$/i.test(basename)) return 'SOUL.md'
  if (/^memory\.md$/i.test(basename)) return 'MEMORY.md'
  return value
}
