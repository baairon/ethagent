/**
 * Emit a Claude Code PreToolUse "deny" decision. Shared by the memory, skill, and
 * combined guards so the hook output shape lives in exactly one place.
 */
export function writePreToolDeny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n',
  )
}
