import { z } from 'zod'
import {
  preparePrivateContinuityEdit,
  writePreparedPrivateContinuityEdit,
} from '../identity/continuity/privateEdit.js'
import { recordPrivateContinuityHistorySnapshot } from '../identity/continuity/history.js'
import { readContinuityFiles, readPublicSkillsFile } from '../identity/continuity/storage.js'
import type { Tool } from './contracts.js'

const schema = z.object({
  file: z.preprocess(normalizePrivateContinuityFile, z.enum(['SOUL.md', 'MEMORY.md'])),
  oldText: z.string().optional(),
  newText: z.string().optional(),
  appendToSection: z.string().optional(),
  appendText: z.string().optional(),
  replaceAll: z.boolean().optional(),
  replaceWholeFile: z.boolean().optional(),
}).superRefine((input, ctx) => {
  const hasOldText = input.oldText !== undefined
  const hasNewText = input.newText !== undefined
  const hasAppendToSection = input.appendToSection !== undefined
  const hasAppendText = input.appendText !== undefined
  const targeted = hasOldText || hasNewText
  const append = hasAppendToSection || hasAppendText
  if (input.replaceWholeFile) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'private continuity files must be edited in place; whole-file replacement is disabled',
      path: ['replaceWholeFile'],
    })
  }
  if (!targeted && !append) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'file alone is not enough; provide either oldText+newText for a targeted edit or appendToSection+appendText for an in-place append',
    })
  }
  if (targeted && append) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'provide only one edit mode: oldText+newText or appendToSection+appendText',
    })
  }
  if (targeted && !input.oldText?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'oldText is required for targeted private continuity edits',
      path: ['oldText'],
    })
  }
  if (targeted && !hasNewText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'newText is required for targeted private continuity edits',
      path: ['newText'],
    })
  }
  if (append && !input.appendToSection?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'appendToSection is required for private continuity appends',
      path: ['appendToSection'],
    })
  }
  if (append && !input.appendText?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'appendText is required for private continuity appends',
      path: ['appendText'],
    })
  }
})

export const privateContinuityEditTool: Tool<typeof schema> = {
  name: 'propose_private_continuity_edit',
  kind: 'private-continuity-edit',
  description: [
    'Propose an explicit user-approved in-place edit to an existing private identity continuity scaffold.',
    'Only the identity-vault SOUL.md and MEMORY.md are valid targets; do not create workspace files with these names.',
    'Do not call read_file, list_directory, or run_bash to locate these files; pass file as SOUL.md or MEMORY.md and this tool resolves the vault path.',
    'For new memories or preferences call exactly: {"file":"MEMORY.md","appendToSection":"Durable User Preferences","appendText":"- User preference or memory note."}.',
    'For persona or standing behavior call exactly: {"file":"SOUL.md","appendToSection":"Persona","appendText":"- Persona or standing behavior note."}.',
    'Prefer appendToSection+appendText to build on an existing scaffold section; use oldText+newText only for targeted replacement after exact text is known.',
    'Whole-file replacement is disabled for private continuity.',
    'Approved private continuity edits are not managed by /rewind; the previous version is saved to private identity history before writing.',
    'Do not use this for public SKILLS.md; suggest SKILLS.md changes in chat for the user to apply manually.',
  ].join(' '),
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      file: { type: 'string', enum: ['SOUL.md', 'MEMORY.md'], description: 'Private continuity file to edit. Use only the file name; do not pass a workspace path.' },
      oldText: { type: 'string', description: 'Exact existing scaffold text to replace. Required for targeted replacement edits.' },
      newText: { type: 'string', description: 'Replacement text for oldText. Do not use this as whole-file content.' },
      appendToSection: { type: 'string', description: 'Existing markdown section heading to append under, for example "Durable User Preferences" or "Persona". Prefer this for new notes.' },
      appendText: { type: 'string', description: 'New non-empty markdown bullet to append under appendToSection. This builds on the existing scaffold instead of overwriting it.' },
      replaceAll: { type: 'boolean', description: 'Replace every exact oldText match. Prefer false unless certain.' },
    },
    required: ['file'],
    additionalProperties: false,
  },
  parse(input) {
    return schema.parse(normalizePrivateContinuityInput(input))
  },
  async buildPermissionRequest(input, context) {
    const prepared = await preparePrivateContinuityEdit(input, context.config)
    return {
      kind: 'private-continuity-edit',
      path: prepared.fullPath,
      relativePath: prepared.relativePath,
      directoryPath: prepared.directoryPath,
      title: 'approve private continuity edit?',
      subtitle: prepared.fullPath,
      file: prepared.file,
      before: prepared.previewBefore,
      after: prepared.previewAfter,
      diff: prepared.diff,
      changeSummary: prepared.changeSummary,
    }
  },
  async execute(input, context) {
    const prepared = await preparePrivateContinuityEdit(input, context.config)
    const [previousFiles, previousPublicSkills] = await Promise.all([
      readContinuityFiles(prepared.identity),
      readPublicSkillsFile(prepared.identity),
    ])
    await recordPrivateContinuityHistorySnapshot({
      identity: prepared.identity,
      file: prepared.file,
      filePath: prepared.fullPath,
      existedBefore: prepared.existedBefore,
      previousContent: prepared.previousContent,
      previousFiles,
      previousPublicSkills,
      changeSummary: prepared.changeSummary,
      createdAt: new Date().toISOString(),
      sessionId: context.checkpoint?.sessionId,
      turnId: context.checkpoint?.turnId,
      promptSnippet: context.checkpoint?.promptSnippet,
      checkpointLabel: context.checkpoint?.checkpointLabel,
    })
    await writePreparedPrivateContinuityEdit(prepared)
    return {
      ok: true,
      summary: prepared.changeSummary,
      content: [
        `updated local private continuity file ${prepared.fullPath}`,
        `review file: ${prepared.fullPath}`,
        'open from identity hub, memory and persona',
        'publish from identity hub snapshots',
        'previous version saved to private identity history; /rewind does not restore identity markdown',
      ].join('\n'),
    }
  },
}

function normalizePrivateContinuityInput(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input }
  if (normalized.appendToSection === undefined) {
    normalized.appendToSection = normalized.section ?? normalized.heading
  }
  if (normalized.appendText === undefined) {
    normalized.appendText = normalized.note ?? normalized.text ?? normalized.content
  }
  return normalized
}

function normalizePrivateContinuityFile(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (/^soul\.md$/i.test(value.trim())) return 'SOUL.md'
  if (/^memory\.md$/i.test(value.trim())) return 'MEMORY.md'
  return value
}
