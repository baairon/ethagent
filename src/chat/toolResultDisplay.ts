const COMPACT_SUCCESS_TOOL_RESULTS = new Set([
  'read_file',
  'read_private_continuity_file',
])

export function hidesSuccessfulToolResultContent(name: string, isError?: boolean): boolean {
  return !isError && COMPACT_SUCCESS_TOOL_RESULTS.has(name)
}
