import { z } from 'zod'
import {
  continuityVaultRef,
} from '../identity/continuity/storage.js'
import { listSkillsTree } from '../identity/continuity/skills/loadSkills.js'
import type { Tool } from './contracts.js'

const schema = z.object({})

export const listSkillsTool: Tool<typeof schema> = {
  name: 'list_private_skills',
  kind: 'private-continuity-read',
  readOnly: true,
  description: [
    'List private skills available in the owner-authored skills tree for the active identity.',
    'Returns each skill folder name with its one-line description; bodies are loaded separately via read_private_skill.',
    'When a skill has supporting files beyond SKILL.md, the entry is annotated with (+N supporting files) so you know to call list_private_skill_files.',
    'Use this when the user mentions a skill not in the injected skill index, or to discover what skills exist.',
  ].join(' '),
  inputSchema: schema,
  inputSchemaJson: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  parse(input) {
    return schema.parse(input ?? {})
  },
  async buildPermissionRequest(_input, context) {
    const identity = context.config?.identity
    if (!identity) throw new Error('No active identity; create or load an identity before listing private skills')
    const ref = continuityVaultRef(identity)
    return {
      kind: 'private-skill-read',
      path: ref.skillsDir,
      relativePath: 'identity-vault/skills',
      directoryPath: ref.skillsDir,
      title: 'Allow private skills index read?',
      subtitle: 'List skill names and descriptions from the private skills tree',
      skillName: '*',
      mode: 'list',
    }
  },
  async execute(_input, context) {
    const identity = context.config?.identity
    if (!identity) {
      return { ok: false, summary: 'no active identity', content: 'No active identity; cannot list private skills.' }
    }
    const { skills, supportingCounts } = await listSkillsTree(identity)
    if (skills.length === 0) {
      return { ok: true, summary: 'no private skills', content: 'The private skills tree is empty.' }
    }
    const lines = skills.map(entry => {
      const display = entry.displayName ?? entry.name
      const desc = entry.description ? ` — ${entry.description}` : ''
      const when = entry.whenToUse ? ` (when: ${entry.whenToUse})` : ''
      const vis = entry.visibility !== 'private' ? ` [visibility: ${entry.visibility}]` : ''
      const supporting = supportingCounts[entry.name] ?? 0
      const trailer = supporting > 0 ? ` (+${supporting} supporting file${supporting === 1 ? '' : 's'})` : ''
      return `- ${display}${desc}${when}${vis}${trailer}`
    })
    return {
      ok: true,
      summary: `listed ${skills.length} private skill${skills.length === 1 ? '' : 's'}`,
      content: lines.join('\n'),
    }
  },
}
