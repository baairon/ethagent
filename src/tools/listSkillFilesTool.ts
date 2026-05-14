import { z } from 'zod'
import path from 'node:path'
import {
  continuityVaultRef,
} from '../identity/continuity/storage.js'
import { listSkillFiles } from '../identity/continuity/skills/loadSkills.js'
import type { Tool } from './contracts.js'

const schema = z.object({
  name: z.string().min(1),
})

export const listSkillFilesTool: Tool<typeof schema> = {
  name: 'list_private_skill_files',
  kind: 'private-continuity-read',
  readOnly: true,
  description: [
    'List every file inside a private skill folder for the active identity.',
    'Returns each file as `- <relativePath> (<bytes>) — <absolutePath>`, including SKILL.md and any supporting files (references, examples, scripts).',
    'Use this after list_private_skills shows a skill with `(+N supporting files)` to discover what is available, then call read_private_skill with `file` to load text content.',
    'Pass the absolute path directly to run_bash to execute supporting scripts (e.g. `python "<absolutePath>" <args>`).',
  ].join(' '),
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill folder name from the private skills index.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const identity = context.config?.identity
    if (!identity) throw new Error('No active identity; create or load an identity before listing private skill files')
    const ref = continuityVaultRef(identity)
    const folder = input.name.replace(/^.*:/, '')
    const skillDir = path.join(ref.skillsDir, folder)
    return {
      kind: 'private-skill-read',
      path: skillDir,
      relativePath: `identity-vault/skills/${folder}`,
      directoryPath: skillDir,
      title: 'Allow private skill folder list?',
      subtitle: `List files in ${folder}/`,
      skillName: input.name,
      mode: 'list',
    }
  },
  async execute(input, context) {
    const identity = context.config?.identity
    if (!identity) {
      return { ok: false, summary: 'no active identity', content: 'No active identity; cannot list private skill files.' }
    }
    try {
      const folder = input.name.replace(/^.*:/, '')
      const files = await listSkillFiles(identity, folder)
      if (files.length === 0) {
        return { ok: true, summary: `no files in ${folder}`, content: `Skill folder ${folder}/ is empty or does not exist.` }
      }
      const lines = files.map(f => `- ${f.relativePath} (${f.sizeBytes} bytes) — ${f.absolutePath}`)
      return {
        ok: true,
        summary: `listed ${files.length} file${files.length === 1 ? '' : 's'} in ${folder}`,
        content: lines.join('\n'),
      }
    } catch (err: unknown) {
      return {
        ok: false,
        summary: 'list failed',
        content: (err as Error).message,
      }
    }
  },
}
