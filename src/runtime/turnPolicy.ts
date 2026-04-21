import {
  assistantRefusesDestructiveLocalAction,
  assistantDefersWorkspaceWrite,
  assistantDefersWorkspaceInspection,
  isLikelyWorkspaceInspectionRequest,
  isLikelyWorkspaceWriteRequest,
  isLikelyDestructiveWorkspaceRequest,
  assistantClaimsMissingWorkspaceContext,
  looksLikeMalformedToolUse,
  parseFallbackToolUses,
  type NormalizedToolUse,
} from '../core/fallbackToolUse.js'
import type { ToolResult } from '../tools/contracts.js'

export type ToolNormalizationResult = {
  toolUses: NormalizedToolUse[]
  repairStatus: 'none' | 'repaired' | 'failed'
  repairMessage?: string
  raw?: string
}

export function normalizeToolWorkFromAssistant(userText: string, text: string): ToolNormalizationResult {
  const toolUses = parseFallbackToolUses(text)
  if (
    toolUses.length > 0 &&
    isLikelyDestructiveWorkspaceRequest(userText) &&
    toolUses.some(toolUse => toolUse.name === 'edit_file' && toolUse.input.newText === '')
  ) {
    return {
      toolUses: [],
      repairStatus: 'failed',
      repairMessage: 'rejected malformed destructive edit repair; retrying for an explicit delete command',
      raw: text,
    }
  }

  if (toolUses.length > 0) {
    return {
      toolUses,
      repairStatus: 'repaired',
      repairMessage:
        toolUses.length === 1
          ? 'repaired malformed tool output into 1 tool action'
          : `repaired malformed tool output into ${toolUses.length} tool actions`,
      raw: text,
    }
  }

  if (looksLikeMalformedToolUse(text)) {
    return {
      toolUses: [],
      repairStatus: 'failed',
      repairMessage: 'model emitted malformed tool output that could not be repaired',
      raw: text,
    }
  }

  return { toolUses: [], repairStatus: 'none' }
}

export function shouldForceToolRetry(userText: string, assistantText: string, toolsAvailable: boolean): boolean {
  if (!toolsAvailable) return false
  if (
    !isLikelyWorkspaceWriteRequest(userText) &&
    !isLikelyDestructiveWorkspaceRequest(userText) &&
    !isLikelyWorkspaceInspectionRequest(userText)
  ) return false

  const trimmed = assistantText.trim()
  if (!trimmed) return false

  return (
    assistantDefersWorkspaceWrite(trimmed) ||
    assistantDefersWorkspaceInspection(trimmed) ||
    assistantClaimsMissingWorkspaceContext(trimmed) ||
    assistantRefusesDestructiveLocalAction(trimmed) ||
    trimmed.includes('```')
  )
}

export function buildToolRetryPrompt(cwd: string): string {
  return [
    `Use the available tools now. The current working directory is ${cwd}.`,
    'If you have not inspected this directory yet, call list_directory first and then read the relevant files before editing.',
    'Create or edit the requested files directly in that directory unless the user named another path.',
    'Do not tell the user to copy, paste, save, or create files manually.',
    'Do not tell the user to run shell commands manually when you can inspect the workspace yourself with the available tools.',
    'Do not claim a file is missing, unreadable, or unknown until you have checked with list_directory and read_file when relevant.',
    'If your previous tool output was malformed, retry with valid tool calls only. Do not print pseudo-tool JSON or raw blobs into the transcript.',
    'If you are writing code, call edit_file with the full file contents.',
    'If the user explicitly asked for a destructive local action like deleting a file, do not refuse outright. Call run_bash with the exact command so the shell permission prompt can handle approval or denial.',
  ].join(' ')
}

export function buildPreToolPlanningPrompt(cwd: string): string {
  return [
    `The working directory is ${cwd}.`,
    'Before editing or creating project files, inspect the current directory with list_directory and read the relevant existing files.',
    'Then perform the requested edits directly with the available tools.',
  ].join(' ')
}

export function shouldRetryRejectedToolInput(result: ToolResult): boolean {
  return !result.ok && /rejected input$/.test(result.summary)
}

export function buildToolInputRepairPrompt(cwd: string, toolName: string, error: string): string {
  return [
    `Your previous ${toolName} tool call used invalid or incomplete arguments in ${cwd}.`,
    `Tool validation error: ${error}.`,
    'Retry now with a valid tool call only.',
    'Do not ask the user to supply arguments you can infer from the request or by inspecting the workspace.',
    'If you need file context first, call list_directory or read_file before retrying the edit.',
    'Do not print pseudo-tool JSON, explanations, or raw blobs into the transcript.',
  ].join(' ')
}
