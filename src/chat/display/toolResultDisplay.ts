import { splitFileChangeResult } from '../../tools/fileDiff.js'

const COMPACT_SUCCESS_TOOL_RESULTS = new Set([
  'read_file',
  'read_private_continuity_file',
])

export function hidesSuccessfulToolResultContent(name: string, isError?: boolean): boolean {
  return !isError && COMPACT_SUCCESS_TOOL_RESULTS.has(name)
}

export function toolResultDiffContent(content: string, isError?: boolean): string | undefined {
  if (isError) return undefined
  return splitFileChangeResult(content).diff
}

export function toolResultTextContent(content: string): string {
  return splitFileChangeResult(content).content
}
