const MAX_ARG_SUMMARY = 80

export function formatToolCall(
  name: string,
  input: Record<string, unknown> | undefined,
): { displayName: string; argSummary: string } {
  const safeInput = isRecord(input) ? input : {}
  switch (name) {
    case 'read_file':
      return { displayName: 'Read', argSummary: readArgs(safeInput) }
    case 'list_directory':
      return { displayName: 'List', argSummary: pathArg(safeInput, '.') }
    case 'run_bash':
      return { displayName: 'Bash', argSummary: bashArgs(safeInput) }
    case 'edit_file':
      return { displayName: 'Edit', argSummary: pathArg(safeInput) }
    case 'write_file':
      return { displayName: 'Write', argSummary: pathArg(safeInput) }
    case 'delete_file':
      return { displayName: 'Delete', argSummary: pathArg(safeInput) }
    case 'change_directory':
      return { displayName: 'Cd', argSummary: pathArg(safeInput) }
    case 'read_private_continuity_file':
      return { displayName: 'ReadPrivate', argSummary: privateArgs(safeInput) }
    case 'propose_private_continuity_edit':
      return { displayName: 'EditPrivate', argSummary: stringArg(safeInput, 'file') }
    case 'list_mcp_resources':
      return { displayName: 'ListMcp', argSummary: stringArg(safeInput, 'server') }
    case 'read_mcp_resource':
      return { displayName: 'ReadMcp', argSummary: mcpReadArgs(safeInput) }
    default:
      return { displayName: humanize(name), argSummary: '' }
  }
}

function readArgs(input: Record<string, unknown>): string {
  const filePath = pathArg(input)
  const start = numberArg(input, 'startLine')
  const end = numberArg(input, 'endLine')
  if (start || end) {
    const range = `lines ${start ?? 1}-${end ?? 'end'}`
    return truncate(filePath ? `${filePath} · ${range}` : range)
  }
  return truncate(filePath)
}

function privateArgs(input: Record<string, unknown>): string {
  const file = stringArg(input, 'file')
  const start = numberArg(input, 'startLine')
  const end = numberArg(input, 'endLine')
  if (start || end) {
    return truncate(`${file} · lines ${start ?? 1}-${end ?? 'end'}`)
  }
  return truncate(file)
}

function bashArgs(input: Record<string, unknown>): string {
  const command = stringArg(input, 'command')
  if (!command) return ''
  const firstLine = command.split('\n')[0]?.trim() ?? ''
  return truncate(firstLine)
}

function mcpReadArgs(input: Record<string, unknown>): string {
  const server = stringArg(input, 'server')
  const uri = stringArg(input, 'uri')
  if (server && uri) return truncate(`${server} / ${uri}`)
  return truncate(server || uri)
}

function pathArg(input: Record<string, unknown>, fallback = ''): string {
  const raw = stringArg(input, 'path')
  if (!raw) return fallback
  return raw.replace(/\\/g, '/')
}

function stringArg(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

function numberArg(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= MAX_ARG_SUMMARY) return flat
  return `${flat.slice(0, MAX_ARG_SUMMARY - 1)}…`
}

function humanize(name: string): string {
  return name
    .split('_')
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
