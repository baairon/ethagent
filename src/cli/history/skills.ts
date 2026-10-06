import type { EthagentIdentity } from '../../storage/config.js'
import { continuityVaultRef } from '../../identity/continuity/storage.js'
import { continuityVaultStatus } from '../../identity/continuity/storage/status.js'
import {
  deleteSkillEntry,
  invalidateSkillsCache,
  listSkillEntriesView,
  setSkillVisibility,
} from '../../identity/continuity/skills/loadSkills.js'
import { packedAgentCard, renderAgentCardJson, syncAgentCardManifest } from '../../identity/continuity/skills/publicSkillsSync.js'
import { isDraftScaffold } from '../../identity/continuity/skills/scaffold.js'
import { readOrDefault } from '../../identity/continuity/storage/files.js'
import type { SkillIndexEntry, SkillVisibility } from '../../identity/continuity/skills/types.js'
import { checkpointVault } from '../../identity/continuity/snapshotCapture.js'
import { emitJson, failFrom, HistoryError, parseHistoryArgs, requireIdentity, type HistoryDeps } from './shared.js'

export const SKILLS_USAGE = 'ethagent skills [--public <name> | --private <name> | --delete <name> [--yes]] [--json]'

const HELP = [
  `usage: ${SKILLS_USAGE}`,
  '',
  '  ethagent skills                  every skill in the vault, its visibility, and whether the',
  '                                   Agent Card publishes it. Read-only.',
  '  ethagent skills --public <name>  publish the skill\'s name and description on the Agent Card.',
  '  ethagent skills --private <name> take it off the Agent Card.',
  '  ethagent skills --delete <name>  remove the skill folder (preview, then --yes). A checkpoint',
  '                                   is taken first, and the output names the rollback that',
  '                                   brings it back.',
  '',
  '<name> is the skill\'s folder under skills/. Changes are local; `ethagent save` publishes them.',
  'A skill without a real description is a draft: the Agent Card leaves it out even when public.',
  '',
].join('\n')

export type SkillsSeams = {
  vaultReady: (identity: EthagentIdentity) => Promise<boolean>
  checkpoint: (identity: EthagentIdentity, label: string) => Promise<string | null>
}

const defaultSeams: SkillsSeams = {
  vaultReady: async identity => (await continuityVaultStatus(identity).catch(() => ({ ready: false }))).ready,
  checkpoint: async (identity, label) => (await checkpointVault(identity, 'manual', { label }))?.id ?? null,
}

type Change = { kind: 'public' | 'private' | 'delete'; name: string }

function parseChange(values: Record<string, string | boolean | string[] | undefined>): Change | null {
  const chosen = (['public', 'private', 'delete'] as const).filter(flag => values[flag] !== undefined)
  if (chosen.length > 1) throw new HistoryError(2, `choose one of ${chosen.map(flag => `--${flag}`).join(', ')}`, `usage: ${SKILLS_USAGE}`)
  const kind = chosen[0]
  if (!kind) return null
  const name = String(values[kind]).trim().replace(/\/+$/, '').replace(/\/SKILL\.md$/i, '')
  if (!name) throw new HistoryError(2, `--${kind} needs a skill name`, `usage: ${SKILLS_USAGE}`)
  return { kind, name }
}

function skillView(entry: SkillIndexEntry): Record<string, unknown> {
  const draft = isDraftScaffold(entry)
  return {
    name: entry.name,
    ...(entry.displayName && entry.displayName !== entry.name ? { displayName: entry.displayName } : {}),
    description: entry.description,
    visibility: entry.visibility,
    onAgentCard: entry.visibility === 'public' && !draft,
    draft,
    path: `skills/${entry.relativePath}`,
  }
}

export async function runSkillsCommand(args: string[], deps: HistoryDeps, seams: SkillsSeams = defaultSeams): Promise<number> {
  const json = args.includes('--json')
  try {
    const { values, positionals } = parseHistoryArgs(args, {
      public: { type: 'string' },
      private: { type: 'string' },
      delete: { type: 'string' },
      yes: { type: 'boolean' },
    }, SKILLS_USAGE)
    if (values.help) {
      await deps.io.out(HELP)
      return 0
    }
    if (positionals.length > 0) throw new HistoryError(2, `unexpected argument: ${positionals[0]}`, `usage: ${SKILLS_USAGE}`)
    const change = parseChange(values)
    if (values.yes && change?.kind !== 'delete') throw new HistoryError(2, '--yes only applies to --delete', `usage: ${SKILLS_USAGE}`)
    const { identity } = await requireIdentity(deps)
    if (!(await seams.vaultReady(identity))) {
      throw new HistoryError(1, 'Local continuity files are not restored on this machine.', 'Bring them back with `ethagent restore`.')
    }
    const ref = continuityVaultRef(identity)
    const entries = await listSkillEntriesView(ref.skillsDir)

    if (!change) {
      const current = await readOrDefault(ref.agentCardPath, '')
      const cardStale = packedAgentCard(current, renderAgentCardJson(identity, entries)).stale
      const skills = entries.map(skillView)
      if (json) {
        await emitJson(deps.io, { skills, agentCardInSync: !cardStale })
      } else if (skills.length === 0) {
        await deps.io.out(`No skills yet. Add a folder with a SKILL.md under ${ref.skillsDir}.\n`)
      } else {
        const width = Math.max(...skills.map(skill => String(skill.name).length))
        const lines = skills.map(skill => {
          const tag = skill.onAgentCard ? 'public' : skill.visibility === 'public' ? 'public (draft, not on the card)' : 'private'
          return `${String(skill.name).padEnd(width)}  ${tag.padEnd(7)}  ${String(skill.description)}`
        })
        if (cardStale) lines.push('', 'The agent card file is behind these skills; it is rewritten on the next change or save.')
        await deps.io.out(`${lines.join('\n')}\n`)
      }
      return 0
    }

    const entry = entries.find(item => item.name === change.name)
    if (!entry) {
      const known = entries.map(item => item.name)
      throw new HistoryError(1, `No skill named ${change.name}.`, known.length ? `Skills in this vault: ${known.join(', ')}.` : 'This vault has no skills yet.')
    }

    if (change.kind === 'delete') {
      if (!values.yes) {
        const preview = { applied: false, action: 'delete', skill: skillView(entry), removes: `skills/${entry.name}/` }
        if (json) await emitJson(deps.io, preview)
        else await deps.io.out(`Preview: removes skills/${entry.name}/ and everything in it${entry.visibility === 'public' ? ', and takes it off the Agent Card' : ''}. A checkpoint is taken first. Run again with --yes.\n`)
        return 0
      }
      const checkpoint = await seams.checkpoint(identity, `before skills --delete ${entry.name}`)
      await deleteSkillEntry(identity, entry.relativePath)
      invalidateSkillsCache(identity)
      await syncAgentCardManifest(identity)
      const undo = checkpoint ? `ethagent rollback cp:${checkpoint} --yes` : null
      if (json) await emitJson(deps.io, { applied: true, action: 'delete', name: entry.name, checkpoint, undo })
      else await deps.io.out(`Deleted skills/${entry.name}/.${undo ? ` Undo with \`${undo}\`.` : ''} \`ethagent save\` publishes the change.\n`)
      return 0
    }

    const visibility: SkillVisibility = change.kind
    const unchanged = entry.visibility === visibility
    if (!unchanged) {
      await setSkillVisibility(identity, entry.relativePath, visibility)
      invalidateSkillsCache(identity)
    }
    await syncAgentCardManifest(identity)
    const draft = isDraftScaffold(entry)
    const onAgentCard = visibility === 'public' && !draft
    if (json) {
      await emitJson(deps.io, { applied: !unchanged, name: entry.name, visibility, onAgentCard, draft })
    } else {
      const lines = [unchanged ? `${entry.name} is already ${visibility}.` : `${entry.name} is now ${visibility}.`]
      if (visibility === 'public' && draft) lines.push('It has no real description yet, so the Agent Card leaves it out until it does.')
      else if (visibility === 'public') lines.push('Its name and description go on the Agent Card; keep personal details out of them.')
      if (!unchanged) lines.push('`ethagent save` publishes the change.')
      await deps.io.out(`${lines.join('\n')}\n`)
    }
    return 0
  } catch (err) {
    return failFrom(deps.io, json, err)
  }
}
