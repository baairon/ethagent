import path from 'node:path'
import { z } from 'zod'
import {
  continuityVaultRef,
} from '../identity/continuity/storage.js'
import {
  readSkill,
  readSkillFile,
} from '../identity/continuity/skills/loadSkills.js'
import type { Tool } from './contracts.js'

const schema = z.object({
  name: z.string().min(1),
  file: z.string().min(1).optional(),
})

export const readSkillTool: Tool<typeof schema> = {
  name: 'read_private_skill',
  kind: 'private-continuity-read',
  readOnly: true,
  description: [
    'Read a file from the owner-authored private skill folder for the active identity.',
    'Pass the skill folder name as `name` (e.g. "writing-obit"). Without `file`, returns the SKILL.md entry point.',
    'With `file`, returns a supporting file from the same folder (e.g. file: "references/api.md"). Supporting-file responses include an absolute filesystem `path=` attribute; run executable scripts via run_bash using that absolute path.',
    'List available supporting files with list_private_skill_files. Bodies are markdown and may include private instructions; treat them like SOUL.md guidance.',
  ].join(' '),
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill folder name from the private skills index, e.g. "writing-obit".' },
      file: { type: 'string', description: 'Optional supporting file path inside the skill folder. Defaults to SKILL.md.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  parse(input) {
    return schema.parse(input)
  },
  async buildPermissionRequest(input, context) {
    const identity = context.config?.identity
    if (!identity) throw new Error('No active identity; create or load an identity before reading a private skill')
    const ref = continuityVaultRef(identity)
    const folder = input.name.replace(/^.*:/, '')
    const file = input.file ?? 'SKILL.md'
    const skillPath = path.join(ref.skillsDir, folder, file)
    const display = input.file ? `${folder}/${input.file}` : `${folder}/SKILL.md`
    return {
      kind: 'private-skill-read',
      path: skillPath,
      relativePath: `identity-vault/skills/${display}`,
      directoryPath: path.dirname(skillPath),
      title: 'Allow private skill read?',
      subtitle: `Load ${display}`,
      skillName: input.name,
      mode: 'read',
    }
  },
  async execute(input, context) {
    const identity = context.config?.identity
    if (!identity) {
      return { ok: false, summary: 'no active identity', content: 'No active identity; cannot read private skill.' }
    }
    try {
      const folder = input.name.replace(/^.*:/, '')
      if (input.file && input.file !== 'SKILL.md') {
        const result = await readSkillFile(identity, folder, input.file)
        return {
          ok: true,
          summary: `read ${result.relativePath}`,
          content: [
            `<private_skill_file name="${folder}" file="${input.file}" path="${result.absolutePath}">`,
            result.content,
            '</private_skill_file>',
          ].join('\n'),
        }
      }
      const skill = await readSkill(identity, folder)
      const meta: string[] = []
      meta.push(`name: ${skill.displayName ?? skill.name}`)
      if (skill.whenToUse) meta.push(`when_to_use: ${skill.whenToUse}`)
      if (skill.argumentHint) meta.push(`argument_hint: ${skill.argumentHint}`)
      if (skill.version) meta.push(`version: ${skill.version}`)
      if (skill.tags && skill.tags.length > 0) meta.push(`tags: ${skill.tags.join(', ')}`)
      meta.push(`visibility: ${skill.visibility}`)
      const content = [
        `<private_skill name="${skill.name}" visibility="${skill.visibility}">`,
        ...meta,
        '',
        skill.body,
        '</private_skill>',
      ].join('\n')
      return {
        ok: true,
        summary: `read private skill ${skill.name}`,
        content,
      }
    } catch (err: unknown) {
      const message = (err as Error).message
      return {
        ok: false,
        summary: 'read failed',
        content: message,
      }
    }
  },
}
