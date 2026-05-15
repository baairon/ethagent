import type { Provider } from '../providers/contracts.js'
import {
  looksLikeToolStateClaim,
} from './toolClaimGuards.js'
import type { ContinuationNudgeReason, ExecutedToolUse } from './turnTypes.js'

export const MAX_CONTINUATION_NUDGES = 3
export const MAX_TOOL_USES_PER_TURN = 25

const CONTINUATION_NUDGE_TEXT =
  'Continue with the task. Use the appropriate tools to proceed.'

const TOOL_CAPABILITY_NUDGE_TEXT =
  'You do have access to the provided tools in this environment. Continue by making the appropriate tool call; do not ask the user to run commands or paste command output.'

const TOOL_STATE_CLAIM_NUDGE_TEXT =
  'Do not claim that files, directories, or workspace state changed unless you have executed the appropriate tool. Call the tool now.'

export const TOOL_STATE_CLAIM_REPAIR_NUDGE_TEXT =
  'The previous assistant response claimed workspace state without executing a tool. '
  + 'Treat that claim as unreliable. '
  + TOOL_STATE_CLAIM_NUDGE_TEXT

export const TOOL_PROTOCOL_FAKE_NUDGE_TEXT =
  'The previous response printed tool names or a tool menu instead of calling a tool. Tool names are not text output. Make exactly one native tool call now.'

export const TOOL_DELEGATION_NUDGE_TEXT =
  'Do not ask the user to run native tools. You have access to the tools in this environment. Make exactly one native tool call now.'

export const TOOL_BUDGET_NUDGE_TEXT =
  'You have reached the tool-call budget for this turn. Do not call any more tools. Produce your final answer now using only what you already know from earlier tool results.'

const PRIVATE_CONTINUITY_NUDGE_TEXT =
  'SOUL.md and MEMORY.md are existing private identity-vault scaffold files. Do not search workspace folders, read plans/, create files, or overwrite them. If exact private text is needed for a surgical removal or targeted replacement, call read_private_continuity_file with {"file":"MEMORY.md"} or {"file":"SOUL.md"}. If the user wants private continuity changed, call propose_private_continuity_edit. For memory/preferences use {"file":"MEMORY.md","appendToSection":"Durable User Preferences","appendText":"- User preference or memory note."}. For persona use {"file":"SOUL.md","appendToSection":"Persona","appendText":"- Persona or standing behavior note."}.'

const PRIVATE_CONTINUITY_REPAIR_NUDGE_TEXT =
  'The previous propose_private_continuity_edit call had invalid or missing input. Retry the same native tool now with complete arguments. Do not answer in prose and do not search for markdown files. For memory/preferences use {"file":"MEMORY.md","appendToSection":"Durable User Preferences","appendText":"- User preference or memory note."}. For persona use {"file":"SOUL.md","appendToSection":"Persona","appendText":"- Persona or standing behavior note."}.'

const WRITE_FILE_REPAIR_NUDGE_TEXT =
  'The previous write_file call was rejected because the arguments were missing or malformed. Retry the same native tool now with a JSON object (not a JSON string) shaped exactly like {"path":"relative/path.ext","content":"...complete file contents..."}. Both fields are required and must be non-empty. Do not answer in prose.'

export const REASONING_ONLY_NUDGE_TEXT =
  'You produced private reasoning but no user-visible answer. Answer the user now in visible text. Do not continue only with reasoning.'

type RepairNudge = {
  text: string
  reason: ContinuationNudgeReason
  failureMessage: string
}

export function nextToolResultRepairNudge(
  provider: Pick<Provider, 'id' | 'supportsTools'>,
  completedTools: ExecutedToolUse[],
): RepairNudge | null {
  if (!provider.supportsTools) return null
  const failedPrivateEdit = completedTools.some(completed =>
    completed.name === 'propose_private_continuity_edit'
    && !completed.result.ok
    && completed.result.summary === 'propose_private_continuity_edit rejected input',
  )
  if (failedPrivateEdit) {
    return {
      text: PRIVATE_CONTINUITY_REPAIR_NUDGE_TEXT,
      reason: 'private_continuity_tool_repair',
      failureMessage: 'Model called propose_private_continuity_edit with invalid input after corrective nudges',
    }
  }

  const failedWriteFile = completedTools.some(completed =>
    completed.name === 'write_file'
    && !completed.result.ok
    && completed.result.summary === 'write_file rejected input',
  )
  if (failedWriteFile) {
    return {
      text: WRITE_FILE_REPAIR_NUDGE_TEXT,
      reason: 'write_file_repair',
      failureMessage: 'Model called write_file with invalid input after corrective nudges',
    }
  }

  const failedWorkspacePrivateRead = completedTools.some(completed =>
    completed.name === 'read_file'
    && !completed.result.ok
    && /read_private_continuity_file/.test(completed.result.content),
  )
  if (failedWorkspacePrivateRead) {
    return {
      text: 'The previous read_file call targeted private identity continuity markdown. Retry now with read_private_continuity_file and complete input such as {"file":"MEMORY.md"} or {"file":"SOUL.md"}. Do not search workspace folders.',
      reason: 'private_continuity_tool_repair',
      failureMessage: 'Model kept reading private continuity files via read_file after corrective nudges',
    }
  }
  return null
}

export function nextNudge(
  provider: Pick<Provider, 'supportsTools'>,
  assistantText: string,
): { text: string; reason: ContinuationNudgeReason; keepAssistantContext: boolean } | null {
  if (provider.supportsTools && looksLikePrivateContinuityWorkspaceCreationIntent(assistantText)) {
    return {
      text: PRIVATE_CONTINUITY_NUDGE_TEXT,
      reason: 'private_continuity_tool',
      keepAssistantContext: false,
    }
  }
  if (provider.supportsTools && looksLikeToolCapabilityConfusion(assistantText)) {
    return {
      text: TOOL_CAPABILITY_NUDGE_TEXT,
      reason: 'tool_capability',
      keepAssistantContext: false,
    }
  }
  if (looksLikeContinuationIntent(assistantText)) {
    return {
      text: CONTINUATION_NUDGE_TEXT,
      reason: 'continuation',
      keepAssistantContext: true,
    }
  }
  return null
}

export function looksLikePrivateContinuityWorkspaceCreationIntent(text: string): boolean {
  const lower = text.toLowerCase()
  if (!/\b(soul|memory)\.md\b/.test(lower)) return false
  return [
    /\b(create|write|make|generate|scaffold|overwrite|replace|locate|find|search|read|check|inspect)\b.{0,100}\b(soul|memory)\.md\b/,
    /\b(soul|memory)\.md\b.{0,100}\b(create|write|make|generate|scaffold|overwrite|replace|locate|find|search|read|check|inspect)\b/,
    /\bplans?[\\/][^\s]*\b(soul|memory)\b/,
  ].some(pattern => pattern.test(lower))
}

export function looksLikeToolCapabilityConfusion(text: string): boolean {
  const lower = text.toLowerCase()
  const limitation =
    /\b(i (do not|don't|cannot|can't) (have|access|run|execute|inspect|read|list|use)|no direct access|unable to|not able to|currently operating under|limitations and restrictions)\b/
  const toolTask =
    /\b(run|execute|shell command|command output|local machine|terminal|files?|directories|workspace|paste|share the contents)\b/
  return limitation.test(lower) && toolTask.test(lower)
}

export function looksLikeToolStateClaimWithoutTool(text: string): boolean {
  return looksLikeToolStateClaim(text)
}

export function looksLikeFakeToolProtocolText(text: string): boolean {
  const lower = text.toLowerCase()
  if (!lower.trim()) return false

  const toolNames = new Set(
    [...lower.matchAll(/\b(change_directory|edit_file|propose_private_continuity_edit|read_private_continuity_file|list_directory|read_file|run_bash|write_file|delete_file)\b/g)]
      .map(match => match[1]),
  )
  if (toolNames.size < 2) return false

  const codeBlock = /```|code\s*(?:-|:)?\s*block/.test(lower)
  const toolMenu = /\b(available tools|tool functions|functions are|tools are|native tools)\b/.test(lower)
  const actionIntent = /\b(let'?s|let me|i'?ll|i will|first|next)\b.{0,80}\b(list|read|inspect|execute|run|change|edit|write)\b/.test(lower)
  const commaSeparatedTools = /(?:change_directory|edit_file|propose_private_continuity_edit|read_private_continuity_file|list_directory|read_file|run_bash|write_file|delete_file)(?:\s*,\s*|\s+){1,}/.test(lower)

  return (codeBlock || toolMenu || actionIntent) && commaSeparatedTools
}

export function looksLikeToolDelegationText(text: string): boolean {
  const lower = text.toLowerCase()
  if (!lower.trim()) return false

  const toolName = '(?:change_directory|edit_file|propose_private_continuity_edit|read_private_continuity_file|list_directory|read_file|run_bash|write_file|delete_file)'
  if (!new RegExp(`\\b${toolName}\\b`).test(lower)) return false

  const directToolRef = `(?:\`?${toolName}\`?|the\\s+\`?${toolName}\`?\\s+tool)`
  const action = '(?:run|execute|call|use|invoke)'
  const askPrefix = "(?:please|kindly|can you|could you|would you|you can|you should|you need to|you'll need to|try to|go ahead and)"
  const selfPrefix = "(?:i'll|i will|let me|let's|we should|we need to|before proceeding|first|next|now)"

  const askUser = new RegExp(`\\b${askPrefix}\\b.{0,100}\\b${action}\\b.{0,50}${directToolRef}`).test(lower)
  const selfIntent = new RegExp(`\\b${selfPrefix}\\b.{0,100}\\b${action}\\b.{0,50}${directToolRef}`).test(lower)
  const commandForm = new RegExp(`\\b${action}\\s+${directToolRef}\\b`).test(lower)
    && /\b(please|before proceeding|first|next|now|to proceed)\b/.test(lower)
  const asksForOutput = new RegExp(`${directToolRef}.{0,120}\\b(output|result|files?|directory structure|working directory)\\b`).test(lower)
    && /\b(please|you|run|paste|share|provide)\b/.test(lower)

  return askUser || selfIntent || commandForm || asksForOutput
}

export function looksLikeContinuationIntent(text: string): boolean {
  const lower = text.toLowerCase()

  const completionMarkers =
    /\b(done|finished|completed|complete|summary|that's all|that is all|all set|hope this helps|let me know if)\b/
  if (completionMarkers.test(lower)) return false

  const actionVerbs =
    '(do|create|write|edit|update|fix|implement|add|run|check|make|build|set up|go|proceed|begin)'

  const shortMessage = lower.length < 80

  const patterns: RegExp[] = [
    new RegExp(
      `\\bso now (i|let me|we) (need to|have to|should|must|will) ${actionVerbs}\\b`,
    ),
    new RegExp(`\\bnow i('ll| will) ${actionVerbs}\\b`),
    new RegExp(
      `\\blet me (go ahead and |now )?${actionVerbs}\\b`,
    ),
    new RegExp(`\\btime to ${actionVerbs}\\b`),
  ]

  if (shortMessage) {
    patterns.push(
      new RegExp(
        `\\bi('ll| will| need to| have to| must) (now )?${actionVerbs}\\b`,
      ),
      new RegExp(
        `\\bnext,?\\s+(i('ll| will)|let me|i need to) ${actionVerbs}\\b`,
      ),
    )
  }

  return patterns.some(re => re.test(lower))
}
