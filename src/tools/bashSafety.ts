const RISKY_PATTERN_CHECKS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /[`]/, message: 'contains backtick command substitution' },
  { pattern: /\$\(/, message: 'contains $() command substitution' },
  { pattern: /\$\{/, message: 'contains parameter expansion' },
  { pattern: /(^|[^\\])[|]/, message: 'contains a pipe' },
  { pattern: /(^|[^\\])&&/, message: 'contains && chaining' },
  { pattern: /(^|[^\\])\|\|/, message: 'contains || chaining' },
  { pattern: /(^|[^\\]);/, message: 'contains ; chaining' },
  { pattern: /(^|[^\\])[<>]/, message: 'contains shell redirection' },
  { pattern: /\r|\n/, message: 'contains a newline' },
  { pattern: /<<|<\(|>\(/, message: 'contains heredoc or process substitution syntax' },
]

const HIGH_RISK_COMMANDS = new Set([
  'chmod',
  'chown',
  'curl',
  'dd',
  'del',
  'diskpart',
  'erase',
  'format',
  'git',
  'icacls',
  'mkfs',
  'powershell',
  'pwsh',
  'reg',
  'rm',
  'rmdir',
  'scp',
  'ssh',
  'takeown',
  'wget',
])

const NON_PERSISTABLE_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'format',
  'mkfs',
  'dd',
  'diskpart',
  'reg',
  'powershell',
  'pwsh',
])

const NATIVE_TOOL_COMMANDS = new Map([
  ['change_directory', 'Use the change_directory tool directly instead of passing change_directory to run_bash.'],
  ['edit_file', 'Use the edit_file tool directly instead of passing edit_file to run_bash.'],
  ['propose_private_continuity_edit', 'Use the propose_private_continuity_edit tool directly instead of passing it to run_bash.'],
  ['read_private_continuity_file', 'Use the read_private_continuity_file tool directly instead of passing it to run_bash.'],
  ['list_directory', 'Use the list_directory tool directly instead of passing list_directory to run_bash.'],
  ['list_mcp_resources', 'Use the list_mcp_resources tool directly instead of passing it to run_bash.'],
  ['read_mcp_resource', 'Use the read_mcp_resource tool directly instead of passing it to run_bash.'],
  ['read_file', 'Use the read_file tool directly instead of passing read_file to run_bash.'],
  ['run_bash', 'run_bash cannot run itself. Put an actual shell command in the command field.'],
])

export type BashSafetyAssessment = {
  warning?: string
  canPersistExact: boolean
  canPersistPrefix: boolean
  commandPrefix: string
}

const PROSE_STARTERS = new Set([
  'a',
  'an',
  'and',
  'for',
  'here',
  'i',
  'it',
  'lets',
  'now',
  'okay',
  'please',
  'snake',
  'sure',
  'that',
  'the',
  'then',
  'this',
  'we',
  'you',
  'youll',
])

export function assessBashCommand(command: string): BashSafetyAssessment {
  const trimmed = command.trim()
  const firstToken = extractFirstToken(trimmed)
  const highRisk = firstToken ? HIGH_RISK_COMMANDS.has(firstToken.toLowerCase()) : false
  const nonPersistable = firstToken ? NON_PERSISTABLE_COMMANDS.has(firstToken.toLowerCase()) : false
  const triggeredChecks = RISKY_PATTERN_CHECKS.filter(check => check.pattern.test(command)).map(check => check.message)

  const warning = triggeredChecks.length > 0
    ? `warning: ${triggeredChecks[0]}. reusable approval is limited for this command.`
    : highRisk
      ? `warning: ${firstToken} is a high-impact command. reusable approval is limited for this command.`
      : undefined

  return {
    warning,
    canPersistExact: triggeredChecks.length === 0 && !nonPersistable,
    canPersistPrefix: triggeredChecks.length === 0 && !highRisk && Boolean(firstToken),
    commandPrefix: firstToken,
  }
}

export function validateBashCommandInput(command: string): string | undefined {
  const trimmed = command.trim()
  if (!trimmed) return 'command must not be empty'

  const firstToken = extractFirstToken(trimmed)
  if (!firstToken) return 'command must start with an executable or shell builtin'

  const normalizedFirstToken = normalizeCommandToken(firstToken)
  if (!normalizedFirstToken) {
    return 'command must start with an executable or shell builtin'
  }

  if (PROSE_STARTERS.has(normalizedFirstToken)) {
    return 'command must be an actual shell command, not explanatory prose'
  }

  const nativeToolMessage = NATIVE_TOOL_COMMANDS.get(normalizedFirstToken)
  if (nativeToolMessage) {
    return `command must be an actual shell command, not an ethagent tool name. ${nativeToolMessage}`
  }

  if (
    /\b(you can|you should|you need|run the following command|written in|under the|to run(?: the game)?|copy and paste|save (?:it|this))/i.test(trimmed)
  ) {
    return 'command must be an actual shell command, not explanatory prose'
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const hasShellSyntax = /[|&;<>]/.test(trimmed)
  if (!hasShellSyntax && /[.!?]$/.test(trimmed) && words.length >= 4) {
    return 'command must be an actual shell command, not explanatory prose'
  }

  return undefined
}

function extractFirstToken(command: string): string {
  const trimmed = command.trim()
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1)
    if (end > 1) return trimmed.slice(0, end + 1)
  }
  if (trimmed.startsWith("'")) {
    const end = trimmed.indexOf("'", 1)
    if (end > 1) return trimmed.slice(0, end + 1)
  }
  const match = trimmed.match(/^([^\s"'`]+)/)
  return match?.[1] ?? ''
}

function normalizeCommandToken(token: string): string {
  return token
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)
    ?.replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '') ?? ''
}
