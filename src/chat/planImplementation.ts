import type { SessionMessage } from '../storage/sessions.js'

const MAX_HANDOFF_SUMMARY_CHARS = 12_000

export function chatFooterShortcutText(_canScrollTranscript: boolean): string {
  return 'alt+p model · alt+i identity'
}

export function buildPlanImplementationPrompt(plan: string): string {
  return [
    'Implement the approved plan below.',
    '',
    'Use native ethagent tools directly. Do not translate tool names into shell commands.',
    'For workspace inspection, call list_directory and read_file directly.',
    'For file creation or edits, call edit_file directly.',
    'Use run_bash only for an actual shell command that cannot be performed by a narrower native tool, such as starting a local server after files exist.',
    'Ignore any plan wording that says to execute file work as a Bash script or directly in the terminal; the native tools above are authoritative.',
    'Read the relevant files before editing, make the required changes, and verify the result when possible.',
    '',
    plan,
  ].join('\n')
}

export function buildPlanTransferSeedMessages(args: {
  sourceSessionId: string
  summary: string
  plan: string
  createdAt: string
}): SessionMessage[] {
  return [
    {
      role: 'user',
      synthetic: true,
      content: [
        `Planning handoff from ${args.sourceSessionId.slice(0, 8)}:`,
        '',
        args.summary.trim(),
      ].join('\n'),
      createdAt: args.createdAt,
    },
    {
      role: 'user',
      synthetic: true,
      content: [
        'Approved plan to implement:',
        '',
        args.plan.trim(),
      ].join('\n'),
      createdAt: args.createdAt,
    },
  ]
}

export function normalizeHandoffSummary(summary: string): string {
  const trimmed = summary.trim()
  if (trimmed.length <= MAX_HANDOFF_SUMMARY_CHARS) return trimmed
  return [
    trimmed.slice(0, MAX_HANDOFF_SUMMARY_CHARS - 96).trimEnd(),
    '',
    '[handoff truncated to keep the resumed conversation responsive]',
  ].join('\n')
}
