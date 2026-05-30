import { runSync } from './sync.js'

// Injected into the model's context on session start so it records durable facts
// in the portable markers (which sync to the vault) instead of harness-local files.
export function buildSessionStartContext(): string {
  return (
    "ethagent portable memory is active. As you converse, keep this agent's soul and memory current by editing " +
    '~/.claude/CLAUDE.md directly: durable user and project facts go between the `<!-- ethagent:memory:start -->` and ' +
    '`<!-- ethagent:memory:end -->` markers; persona, voice, and standards go between the `<!-- ethagent:soul:start -->` ' +
    'and `<!-- ethagent:soul:end -->` markers. Do NOT create separate files in the Claude Code native memory directory ' +
    '(~/.claude/projects/.../memory/), since they do not travel with the agent. Edits between the markers sync to the ' +
    'onchain vault automatically.'
  )
}

// SessionStart hook: restore (sync vault -> harness) then remind (inject guidance).
// runSync is quiet here so only the JSON envelope reaches stdout for the harness to parse.
export async function runSessionStart(): Promise<number> {
  try {
    await runSync({ quiet: true })
  } catch {
    // still emit guidance even if the sync step failed
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: buildSessionStartContext(),
      },
    }) + '\n',
  )
  return 0
}
