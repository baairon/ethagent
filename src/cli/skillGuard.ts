import { loadConfig } from '../storage/config.js'
import { hookFilePath, isWithinDir, readHookPayload } from './hookIo.js'
import { claudeSkillsDir } from './syncAdapters/claude-code.js'

export const SKILL_REDIRECT_REASON =
  "ethagent keeps this agent's skills in its portable continuity vault and generates the ~/.claude/skills " +
  'mirror from it. Skills you create or edit directly here do not travel with the agent, and ethagent-managed ' +
  'mirror copies are regenerated from the vault on the next sync. Author or edit skills in the vault instead: ' +
  'run `ethagent` and open Skills (create, edit, set visibility) so they are versioned, encrypted, and synced ' +
  'into every harness automatically. New skills are private by default; switch one to public only when you want ' +
  'it listed on your Agent Card.'

export function decideSkillGuard(
  filePath: string | null | undefined,
  opts: { identityPresent: boolean },
): { deny: boolean; reason?: string } {
  if (!opts.identityPresent) return { deny: false }
  if (!filePath) return { deny: false }
  // Scope: this guards the Claude Code skills mirror only. The Codex
  // ~/.codex/AGENTS.md skill mirror is intentionally left unguarded, matching
  // the Claude-only --memory-guard — the PreToolUse hook is registered only in
  // the Claude Code plugin manifest.
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
    if (decision.deny) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          },
        }) + '\n',
      )
    }
  } catch {}
  return 0
}
