export type NormalizedToolUse = {
  id: string
  name: string
  input: Record<string, unknown>
}

export function parseFallbackToolUses(text: string): NormalizedToolUse[] {
  const parsedToolUses = parseFallbackToolCalls(text)
  if (parsedToolUses.length > 0) return parsedToolUses

  const parsedShellCommands = parseFallbackShellCommands(text)
  if (parsedShellCommands.length > 0) return parsedShellCommands

  const parsedFileCreations = parseFallbackFileCreations(text)
  if (parsedFileCreations.length > 0) return parsedFileCreations

  return []
}

export function looksLikeMalformedToolUse(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return (
    /\b(change_directory|list_directory|edit_file|read_file|run_bash)\b/.test(trimmed) ||
    /"name"\s*:\s*"(change_directory|list_directory|edit_file|read_file|run_bash)"/.test(trimmed)
  )
}

export function detectDirectoryChangeIntent(text: string): { path: string } | undefined {
  const trimmed = text.trim()
  const match = trimmed.match(/^(?:can\s+you\s+)?(?:please\s+)?(?:cd|change\s+directory(?:\s+to)?|go\s+to|switch\s+to|move\s+to)\s+(.+)$/i)
  if (!match) return undefined
  const rawPath = normalizeIntentPhrase(match[1]!)
  if (!rawPath) return undefined
  return { path: rawPath }
}

export function detectDeleteFileIntent(text: string): { path: string } | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (!/\b(delete|remove|rm|del|trash|erase)\b/i.test(trimmed)) return undefined

  const quotedPath = trimmed.match(/["'`]+([^"'`\n]+\.[A-Za-z0-9_-]+)["'`]+/)
  if (quotedPath?.[1]) return { path: quotedPath[1].trim() }

  const inlinePath = trimmed.match(/\b([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]+)\b/)
  if (inlinePath?.[1]) return { path: inlinePath[1].trim() }

  return undefined
}

export function isLikelyWorkspaceWriteRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /\b(create|write|edit|update|save|make|build|generate)\b/i.test(trimmed) &&
    /\b(file|html|css|javascript|js|script|component|page|game|app|project|website|site)\b/i.test(trimmed)
}

export function isLikelyWorkspaceInspectionRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /\b(read|inspect|debug|investigate|look at|check|analyze|review|figure out|open|list)\b/i.test(trimmed) &&
    /\b(file|files|folder|directory|project|repo|repository|workspace|bug|issue|problem|error|script|html|css|javascript|js)\b/i.test(trimmed)
}

export function isLikelyDestructiveWorkspaceRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /\b(delete|remove|rm|del|erase|trash|wipe|clear out|rmdir)\b/i.test(trimmed) &&
    /\b(file|files|folder|folders|directory|directories|workspace|project|path)\b/i.test(trimmed)
}

export function assistantDefersWorkspaceWrite(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /(?:copy|paste|save|write)\s+(?:this|the code|it)\s+(?:into|to)\s+(?:a|the)\s+file/i.test(trimmed) ||
    /you can copy and paste this code/i.test(trimmed) ||
    /save it(?:\s+as)?\s+[`'"]?[\w./\\-]+\.[\w-]+[`'"]?/i.test(trimmed) ||
    /open the file in (?:your|a)\s+browser/i.test(trimmed)
}

export function assistantDefersWorkspaceInspection(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /run the following command/i.test(trimmed) ||
    /let'?s start by listing the files/i.test(trimmed) ||
    /after that, if necessary, we can read the contents/i.test(trimmed) ||
    /```(?:sh|bash|zsh|cmd|powershell|ps1)?[\s\S]*```/i.test(trimmed)
}

export function assistantClaimsMissingWorkspaceContext(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /i (?:can(?:not|'t)|do not|don't) (?:see|find|access|read|locate|know about)\b/i.test(trimmed) ||
    /there (?:is|are) no (?:files|file|directory|folders?)\b/i.test(trimmed) ||
    /i need (?:you )?to (?:show|paste|provide) the file/i.test(trimmed)
}

export function assistantRefusesDestructiveLocalAction(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return /i(?:'m| am)?\s+sorry,?\s+but\s+i\s+can(?:not|'t)\s+assist\s+with\s+deleting\s+files/i.test(trimmed) ||
    /i\s+can(?:not|'t)\s+assist\s+with\s+(?:deleting\s+files|making\s+destructive\s+changes)/i.test(trimmed) ||
    /let\s+me\s+know\s+if\s+you\s+have\s+any\s+other\s+questions/i.test(trimmed) && /\b(delete|remove|rm|del|destructive)\b/i.test(trimmed)
}

function parseFallbackToolCalls(text: string): NormalizedToolUse[] {
  const out: NormalizedToolUse[] = []
  const prefixed = parsePrefixedToolCall(text)
  if (prefixed) out.push(prefixed)

  const runCall = parseRunWrapperToolCall(text)
  if (runCall) out.push(runCall)

  const candidates = extractJsonCandidates(text)
  for (const candidate of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue

    const record = parsed as Record<string, unknown>
    const rawName = typeof record.name === 'string' ? record.name : undefined
    const rawArguments =
      record.arguments && typeof record.arguments === 'object'
        ? record.arguments as Record<string, unknown>
        : record.input && typeof record.input === 'object'
          ? record.input as Record<string, unknown>
          : undefined
    if (!rawName || !rawArguments) continue

    const normalized = normalizeFallbackToolUse(rawName, rawArguments)
    if (!normalized) continue

    out.push({ id: `fallback-${Date.now()}-${out.length}`, ...normalized })
  }

  return dedupeToolUses(out)
}

function parseRunWrapperToolCall(text: string): NormalizedToolUse | undefined {
  const match = text.match(/\brun\s*\(\s*(\{[\s\S]*?\})\s*\)/i)
  if (!match?.[1]) return undefined
  const input = safeJsonParseObject(match[1])
  if (!input) return undefined
  if (typeof input.command !== 'string') return undefined
  return {
    id: `fallback-${Date.now()}`,
    name: 'run_bash',
    input: typeof input.cwd === 'string'
      ? { command: input.command, cwd: input.cwd }
      : { command: input.command },
  }
}

function parsePrefixedToolCall(text: string): NormalizedToolUse | undefined {
  const toolMatch = text.match(/\b(change_directory|list_directory|edit_file|read_file|run_bash)\b/)
  if (!toolMatch || toolMatch.index === undefined) return undefined
  const start = text.indexOf('{', toolMatch.index + toolMatch[0].length)
  if (start === -1) return undefined
  const json = readBalancedJsonObject(text, start)
  if (!json) return undefined
  const input = safeJsonParseObject(json)
  if (!input) return undefined
  const normalized = normalizeFallbackToolUse(toolMatch[1]!, input)
  if (!normalized) return undefined
  return { id: `fallback-${Date.now()}`, ...normalized }
}

function parseFallbackFileCreations(text: string): NormalizedToolUse[] {
  const blocks = [...text.matchAll(/```(?:([\w.+-]+))?\s*\n([\s\S]*?)```/g)]
  if (blocks.length === 0) return []

  const fileMentions = extractFileMentions(text)
  const out: NormalizedToolUse[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    const filePath = findNearestFileMention(text, block.index ?? 0, fileMentions)
      ?? (blocks.length === 1 && fileMentions.length === 1 ? fileMentions[0]!.path : undefined)
    if (!filePath) continue
    const fileContents = (block[2] ?? '').replace(/\s+$/, '')
    if (!fileContents.trim()) continue
    out.push({
      id: `fallback-${Date.now()}-${index}`,
      name: 'edit_file',
      input: {
        path: filePath,
        newText: fileContents,
      },
    })
  }

  return dedupeToolUses(out)
}

function parseFallbackShellCommands(text: string): NormalizedToolUse[] {
  const blocks = [...text.matchAll(/```(sh|bash|zsh|cmd|powershell|ps1)?\s*\n([\s\S]*?)```/gi)]
  if (blocks.length === 0) return []

  const out: NormalizedToolUse[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    const body = (block[2] ?? '').trim()
    if (!body) continue
    const lines = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
    if (lines.length !== 1) continue
    out.push({
      id: `fallback-${Date.now()}-shell-${index}`,
      name: 'run_bash',
      input: { command: lines[0]! },
    })
  }

  return dedupeToolUses(out)
}

function normalizeFallbackToolUse(
  name: string,
  input: Record<string, unknown>,
): { name: string; input: Record<string, unknown> } | undefined {
  if (name === 'run_bash' && typeof input.command === 'string') {
    const cdMatch = input.command.trim().match(/^cd\s+(.+)$/)
    if (cdMatch) {
      return {
        name: 'change_directory',
        input: { path: cdMatch[1]!.trim().replace(/^["']|["']$/g, '') },
      }
    }
  }

  if (name === 'list_directory' || name === 'edit_file' || name === 'run_bash' || name === 'read_file' || name === 'change_directory') {
    return { name, input }
  }

  return undefined
}

function extractJsonCandidates(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:json|code)?\s*([\s\S]*?)```/gi)].map(match => match[1]!.trim())
  const inline = [...text.matchAll(/\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}/g)].map(match => match[0].trim())
  const balanced = extractBalancedJsonObjects(text)
  return [...fenced, ...inline, ...balanced]
}

function safeJsonParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function extractBalancedJsonObjects(text: string): string[] {
  const out: string[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue
    const candidate = readBalancedJsonObject(text, start)
    if (!candidate || !candidate.includes('"name"')) continue
    out.push(candidate)
    start += candidate.length - 1
  }
  return out
}

function readBalancedJsonObject(text: string, start: number): string | undefined {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return undefined
}

type FileMention = { path: string; index: number }

function extractFileMentions(text: string): FileMention[] {
  const mentions: FileMention[] = []
  const patterns = [
    /(?:file named|new file named|create (?:a )?(?:new )?file(?: named)?|save it as|save this as|write (?:this|it|that) to|call the file|name the file)\s+`([^`]+)`/gi,
    /(?:file named|new file named|create (?:a )?(?:new )?file(?: named)?|save it as|save this as|write (?:this|it|that) to|call the file|name the file)\s+"([^"]+)"/gi,
    /(?:file named|new file named|create (?:a )?(?:new )?file(?: named)?|save it as|save this as|write (?:this|it|that) to|call the file|name the file)\s+'([^']+)'/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1]?.trim()
      if (!raw || !/\.[A-Za-z0-9_-]+$/.test(raw)) continue
      mentions.push({ path: raw, index: match.index ?? 0 })
    }
  }

  if (mentions.length === 0) {
    for (const match of text.matchAll(/`([^`\n]+\.[A-Za-z0-9_-]+)`/g)) {
      const raw = match[1]?.trim()
      if (!raw) continue
      mentions.push({ path: raw, index: match.index ?? 0 })
    }
  }

  return mentions
}

function findNearestFileMention(text: string, blockIndex: number, mentions: FileMention[]): string | undefined {
  if (mentions.length === 0) return undefined
  let best: FileMention | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const mention of mentions) {
    const distance = Math.abs(mention.index - blockIndex)
    if (distance > 280) continue
    if (distance < bestDistance) {
      best = mention
      bestDistance = distance
    }
  }

  if (best) return best.path

  const nearbyWindow = text.slice(Math.max(0, blockIndex - 180), Math.min(text.length, blockIndex + 180))
  const inline = nearbyWindow.match(/`([^`\n]+\.[A-Za-z0-9_-]+)`/)
  return inline?.[1]?.trim()
}

function dedupeToolUses(toolUses: NormalizedToolUse[]): NormalizedToolUse[] {
  const seen = new Set<string>()
  const out: NormalizedToolUse[] = []
  for (const toolUse of toolUses) {
    const key = `${toolUse.name}:${JSON.stringify(toolUse.input)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(toolUse)
  }
  return out
}

function normalizeIntentPhrase(input: string): string {
  return input
    .trim()
    .replace(/\?+$/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:into|inside|in)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}
