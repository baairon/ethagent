import { runSync } from './sync.js'
import { ensureDaemon } from './daemon.js'
import { loadConfig, type EthagentIdentity } from '../storage/config.js'
import { continuityVaultRef } from '../identity/continuity/storage.js'

export function buildSessionStartContext(identity?: EthagentIdentity | null): string {
  const skillsWhere = skillsLocationPhrase(identity)
  return (
    "ethagent portable memory is active. As you converse, keep this agent's soul and memory current by editing " +
    '~/.claude/CLAUDE.md directly: durable user and project facts go between the `<!-- ethagent:memory:start -->` and ' +
    '`<!-- ethagent:memory:end -->` markers; persona, voice, and standards go between the `<!-- ethagent:soul:start -->` ' +
    'and `<!-- ethagent:soul:end -->` markers. Do NOT create separate files in the Claude Code native memory directory ' +
    '(~/.claude/projects/.../memory/), since they do not travel with the agent. Edits between the markers sync to the ' +
    'onchain vault automatically. ' +
    `Skills live at ${skillsWhere}, mirrored read-only into ~/.claude/skills (never edit that mirror; it is regenerated ` +
    'from the vault on the next sync). To add a skill, put its folder directly in that vault skills dir: run ' +
    '`npx ethagent --vault-dir` to print the vault path (it is non-interactive). A skill is a `<name>/SKILL.md` ' +
    'folder, private by default. The vault always exists once an identity is set, so never assume it is missing.'
  )
}

function skillsLocationPhrase(identity?: EthagentIdentity | null): string {
  if (identity && identity.chainId && identity.identityRegistryAddress && (identity.agentId || identity.address)) {
    try {
      return `\`${continuityVaultRef(identity).skillsDir}\``
    } catch { /* fall through to the generic phrase */ }
  }
  return "the `skills/` folder in this agent's ethagent vault (run `npx ethagent --vault-dir` to print its path)"
}

export async function runSessionStart(): Promise<number> {
  try {
    await runSync({ quiet: true })
  } catch { /* sync is best-effort; never block session start on it */ }
  try {
    ensureDaemon()
  } catch { /* keeping the autosync daemon alive is best-effort too */ }
  const identity = await loadConfig().then(c => c?.identity ?? null).catch(() => null)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: buildSessionStartContext(identity),
      },
    }) + '\n',
  )
  return 0
}
