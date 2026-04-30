import type { PendingToolUse } from './turn.js'
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

export function directToolUsesForUserText(userText: string, iterationIndex = 0): PendingToolUse[] {
  const text = userText.trim()
  if (!text || text.startsWith('/')) return []

  const cdPath = parseChangeDirectoryIntent(text)
  if (cdPath) {
    return [{
      id: `direct-tool-${iterationIndex}-0`,
      name: 'change_directory',
      input: { path: cdPath },
    }]
  }

  const listPath = parseListDirectoryIntent(text)
  if (listPath !== null) {
    return [{
      id: `direct-tool-${iterationIndex}-0`,
      name: 'list_directory',
      input: listPath ? { path: listPath } : {},
    }]
  }

  const readPath = parseReadFileIntent(text)
  if (readPath) {
    return [{
      id: `direct-tool-${iterationIndex}-0`,
      name: 'read_file',
      input: { path: readPath },
    }]
  }

  return []
}

function parseChangeDirectoryIntent(text: string): string | null {
  const normalized = trimCommandText(text)
  const patterns = [
    /^(?:no[, ]+)?(?:please\s+)?(?:now\s+)?(?:cd|chdir)\s+(?:to\s+|into\s+|in\s+)?(.+)$/i,
    /^(?:no[, ]+)?(?:please\s+)?(?:now\s+)?go\s+(?:to|into|in)\s+(.+)$/i,
    /^(?:no[, ]+)?(?:please\s+)?(?:now\s+)?change\s+(?:the\s+)?(?:current\s+)?(?:directory|folder)\s+(?:to|into)\s+(.+)$/i,
  ]
  return firstPathMatch(normalized, patterns)
}

function parseListDirectoryIntent(text: string): string | null {
  const normalized = trimCommandText(text)
  const patterns = [
    /^(?:please\s+)?(?:ls|dir)$/i,
    /^(?:please\s+)?(?:ls|dir)\s+(.+)$/i,
    /^(?:please\s+)?(?:list|show)\s+(?:the\s+)?(?:files|directories|folders|entries)(?:\s+(?:in|inside|of)\s+(.+))?$/i,
  ]
  const match = firstPathMatch(normalized, patterns)
  if (match) return match
  return patterns.some(pattern => pattern.test(normalized)) ? '' : null
}

function parseReadFileIntent(text: string): string | null {
  const normalized = trimCommandText(text)
  const path = firstPathMatch(normalized, [
    /^(?:please\s+)?(?:read|open|cat)\s+(.+)$/i,
    /^(?:please\s+)?show\s+(?:me\s+)?(?:the\s+)?(?:contents\s+of\s+)?(.+)$/i,
  ])
  if (!path) return null
  return looksLikeConcreteReadTarget(path) ? path : null
}

function firstPathMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const raw = match[1]
    if (raw === undefined) return ''
    const cleaned = cleanPath(raw)
    if (cleaned) return cleaned
  }
  return null
}

function trimCommandText(text: string): string {
  return text
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanPath(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+(?:please|now)$/i, '')
    .trim()
}

function looksLikeConcreteReadTarget(path: string): boolean {
  return path === '.'
    || path.startsWith('~')
    || path.startsWith('./')
    || path.startsWith('../')
    || /^[A-Za-z]:[\\/]/.test(path)
    || path.includes('/')
    || path.includes('\\')
    || /\.[A-Za-z0-9]{1,12}$/.test(path)
}
