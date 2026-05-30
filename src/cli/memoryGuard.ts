import { loadConfig } from '../storage/config.js'
import { hookFilePath, isWithinDir, readHookPayload } from './hookIo.js'
import { claudeCodeNativeMemoryDir } from './syncAdapters/claude-code.js'

// Shown to the model when it tries to write into the harness-native memory dir.
// The redirect points at a different file (~/.claude/CLAUDE.md), so the model's
// next attempt succeeds and there is no deny loop.
export const MEMORY_REDIRECT_REASON =
  "ethagent manages this agent's portable memory. Don't write to the Claude Code native memory directory; " +
  'those files stay on this machine and never reach your onchain vault. Record durable facts by editing ' +
  '~/.claude/CLAUDE.md instead: put user and project facts between the `<!-- ethagent:memory:start -->` and ' +
  '`<!-- ethagent:memory:end -->` markers, and persona, voice, and standards between the ' +
  '`<!-- ethagent:soul:start -->` and `<!-- ethagent:soul:end -->` markers. Those edits sync to your vault automatically.'

export function decideMemoryGuard(
  filePath: string | null | undefined,
  opts: { identityPresent: boolean },
): { deny: boolean; reason?: string } {
  if (!opts.identityPresent) return { deny: false }
  if (!filePath) return { deny: false }
  if (isWithinDir(claudeCodeNativeMemoryDir(), filePath)) {
    return { deny: true, reason: MEMORY_REDIRECT_REASON }
  }
  return { deny: false }
}

// PreToolUse hook for Edit|Write|MultiEdit. Fail-open: any error or missing
// identity allows the write, so the guard never wedges unrelated projects.
export async function runMemoryGuard(): Promise<number> {
  try {
    const config = await loadConfig()
    const filePath = hookFilePath(await readHookPayload())
    const decision = decideMemoryGuard(filePath, { identityPresent: !!config?.identity })
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
  } catch {
    // fail open
  }
  return 0
}
