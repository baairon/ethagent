import { directToolUsesForUserText } from './directToolRouter.js'
import { unsupportedToolStateClaims, type ToolEvidence } from './toolClaimGuards.js'
export { parseLocalModelTextToolUses as extractLocalTextToolUses } from './turn.js'

export type ToolIntent = {
  name: string
  input: Record<string, unknown>
  reason: string
}

/**
 * detectDirectToolIntent — typed detection for high-confidence direct
 * filesystem requests. Returns the first matching intent, or null for
 * ambiguous or multi-step engineering requests so the model handles those.
 *
 * Covers:
 *   - change_directory: "cd into identity", "go to src/identity"
 *   - list_directory: "list files", "show what's here", "ls"
 *   - read_file: "read package.json", "open/show/cat <file>"
 *
 * Returns null for anything else.
 */
export function detectDirectToolIntent(userText: string): ToolIntent | null {
  const uses = directToolUsesForUserText(userText)
  if (uses.length === 0) return null
  const first = uses[0]!
  const reason = intentReason(first.name, first.input)
  return { name: first.name, input: first.input, reason }
}

/**
 * validateAssistantTextAgainstTurnEvidence — checks whether assistant prose
 * claims workspace state that isn't backed by a tool result from the active
 * turn.
 *
 * Returns 'ok' if the text is safe (no unsupported claims), or 'needs-tool'
 * if the text claims state that has no matching tool evidence.
 */
export function validateAssistantTextAgainstTurnEvidence(
  text: string,
  evidence: ToolEvidence[],
): 'ok' | 'needs-tool' {
  const unsupported = unsupportedToolStateClaims(text, evidence)
  return unsupported.length > 0 ? 'needs-tool' : 'ok'
}

function intentReason(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'change_directory':
      return `user requested directory change to ${input.path ?? '.'}`
    case 'list_directory':
      return input.path ? `user requested listing of ${input.path}` : 'user requested directory listing'
    case 'read_file':
      return `user requested read of ${input.path ?? '<unknown>'}`
    default:
      return `user requested ${name}`
  }
}
