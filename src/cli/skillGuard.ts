import { loadConfig } from '../storage/config.js'
import { hookFilePath, isWithinDir, readHookPayload } from './hookIo.js'
import { writePreToolDeny } from './guardOutput.js'
import { claudeSkillsDir } from './syncAdapters/claude-code.js'

export const SKILL_REDIRECT_REASON =
  "~/.claude/skills is a read-only generated mirror of this agent's skills vault. Files you write or edit " +
  'here do not travel with the agent and are overwritten from the vault on the next sync, so retrying the ' +
  'write will not work. Do NOT run `npx ethagent` to fix this yourself: it is interactive, needs a TTY, and ' +
  'will hang the tool call. Adding or editing a skill is a human action: stop here and ask the user to add ' +
  'or edit the skill via `npx ethagent` -> Skills, describing the skill you want. Skills are private by ' +
  'default; ask the user to switch one to public only when they want it listed on the Agent Card.'

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
