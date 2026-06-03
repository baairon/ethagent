import { runSync } from './sync.js'
import { ensureDaemon } from './daemon.js'

export function buildSessionStartContext(): string {
  return (
    "ethagent portable memory is active. As you converse, keep this agent's soul and memory current by editing " +
    '~/.claude/CLAUDE.md directly: durable user and project facts go between the `<!-- ethagent:memory:start -->` and ' +
    '`<!-- ethagent:memory:end -->` markers; persona, voice, and standards go between the `<!-- ethagent:soul:start -->` ' +
    'and `<!-- ethagent:soul:end -->` markers. Do NOT create separate files in the Claude Code native memory directory ' +
    '(~/.claude/projects/.../memory/), since they do not travel with the agent. Edits between the markers sync to the ' +
    'onchain vault automatically. Skills live in the ethagent vault and are mirrored read-only into ~/.claude/skills; ' +
    'do not create or edit files there. To add or change a skill, ask the user to do it via `npx ethagent` -> Skills.'
  )
}

export async function runSessionStart(): Promise<number> {
  try {
    await runSync({ quiet: true })
  } catch { /* sync is best-effort; never block session start on it */ }
  try {
    ensureDaemon()
  } catch { /* keeping the autosync daemon alive is best-effort too */ }
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
