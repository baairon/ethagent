import { loadConfig } from '../storage/config.js'
import { hookFilePath, isWithinDir, readHookPayload } from './hookIo.js'
import { writePreToolDeny } from './guardOutput.js'
import { claudeSkillsDir } from './syncAdapters/claude-code.js'

export const SKILL_REDIRECT_REASON =
  "~/.claude/skills is a read-only generated mirror of this agent's skills vault. Files you write or edit " +
  'here do not travel with the agent and are overwritten from the vault on the next sync, so retrying the ' +
  'write will not work. To add or change a skill, put its folder directly in the vault skills dir instead: ' +
  'run `npx ethagent --vault-dir` to print the vault path (this flag is non-interactive and safe to run), ' +
  'then create or edit the `<name>/SKILL.md` folder inside its `skills/` subdir. Skills are private by ' +
  'default; set one to public only when it should be listed on the Agent Card.'

export function decideSkillGuard(
  filePath: string | null | undefined,
  opts: { identityPresent: boolean },
): { deny: boolean; reason?: string } {
  if (!opts.identityPresent) return { deny: false }
  if (!filePath) return { deny: false }
  if (isWithinDir(claudeSkillsDir(), filePath)) {
    return { deny: true, reason: SKILL_REDIRECT_REASON }
  }
  return { deny: false }
}

export async function runSkillGuard(): Promise<number> {
  try {
    const config = await loadConfig()
    const filePath = hookFilePath(await readHookPayload())
    const decision = decideSkillGuard(filePath, { identityPresent: !!config?.identity })
    if (decision.deny && decision.reason) writePreToolDeny(decision.reason)
  } catch { /* on any guard failure, stay silent and allow the tool call */ }
  return 0
}
