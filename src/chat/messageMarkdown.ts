export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string | null; code: string; open?: boolean }

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }

const UNREADABLE_REASONING_TEXT = 'reasoning output was not readable text'

export function blockContentWidth(lines: string[]): number {
  return Math.max(1, ...lines.map(displayWidth))
}

function displayWidth(line: string): number {
  return (line || ' ').replace(/\t/g, '  ').length
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const text = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!text.trim()) return []

  const blocks: MarkdownBlock[] = []
  const lines = text.split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fence = trimmed.match(/^```([\w+-]*)\s*$/)
    if (fence) {
      const lang = fence[1] && fence[1].length > 0 ? fence[1] : null
      index += 1
      const body: string[] = []
      let closed = false
      while (index < lines.length) {
        const nextLine = lines[index] ?? ''
        if (nextLine.trim().match(/^```\s*$/)) {
          closed = true
          index += 1
          break
        }
        body.push(nextLine)
        index += 1
      }
      blocks.push({ kind: 'code', lang, code: body.join('\n'), open: !closed })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const [, hashes = '#', headingText = ''] = heading
      blocks.push({
        kind: 'heading',
        level: hashes.length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingText.trim(),
      })
      index += 1
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const nextLine = lines[index] ?? ''
        if (!/^>\s?/.test(nextLine.trim())) break
        quoteLines.push(nextLine.trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ kind: 'quote', lines: quoteLines })
      continue
    }

    const ordered = trimmed.match(/^\d+\.\s+(.*)$/)
    const unordered = trimmed.match(/^[-*+]\s+(.*)$/)
    if (ordered || unordered) {
      const items: string[] = []
      const orderedList = Boolean(ordered)
      while (index < lines.length) {
        const nextLine = lines[index] ?? ''
        const match = orderedList
          ? nextLine.trim().match(/^\d+\.\s+(.*)$/)
          : nextLine.trim().match(/^[-*+]\s+(.*)$/)
        if (!match) break
        items.push(match[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered: orderedList, items })
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const nextLine = lines[index] ?? ''
      const nextTrimmed = nextLine.trim()
      if (!nextTrimmed) break
      if (nextTrimmed.match(/^```([\w+-]*)\s*$/)) break
      if (nextLine.match(/^(#{1,6})\s+(.*)$/)) break
      if (/^>\s?/.test(nextTrimmed)) break
      if (nextTrimmed.match(/^\d+\.\s+(.*)$/) || nextTrimmed.match(/^[-*+]\s+(.*)$/)) break
      paragraph.push(nextLine)
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n').trim() })
  }

  return blocks
}

export function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const source = normalizeInlineDisplayText(text)
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|_[^_\n]+?_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: cleanPlainInlineText(source.slice(lastIndex, match.index)) })
    }

    const token = match[0]
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      tokens.push({ kind: 'bold', text: cleanPlainInlineText(token.slice(2, -2)) })
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      tokens.push({ kind: 'italic', text: cleanPlainInlineText(token.slice(1, -1)) })
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ kind: 'code', text: token.slice(1, -1) })
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < source.length || tokens.length === 0) {
    tokens.push({ kind: 'text', text: cleanPlainInlineText(source.slice(lastIndex)) })
  }

  return tokens.filter(token => token.text.length > 0)
}

function normalizeInlineDisplayText(text: string): string {
  return text
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    .replace(/\\\[/g, '')
    .replace(/\\\]/g, '')
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\\([{}[\]()])/g, '$1')
    .replace(/\/([{}])/g, '$1')
}

function cleanPlainInlineText(text: string): string {
  return text.replace(/\*+/g, '')
}

export function summarizeThinking(text: string): string {
  const sample = text.length > 1000 ? text.slice(-1000) : text
  const normalized = sample.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const prefix = text.length > sample.length ? '...' : ''
  if (normalized.length + prefix.length <= 120) return `${prefix}${normalized}`
  return `${prefix}${normalized.slice(Math.max(0, normalized.length - (120 - prefix.length)))}`
}

export function clipTextForDisplay(text: string, maxChars: number): { text: string; omittedChars: number } {
  if (text.length <= maxChars) return { text, omittedChars: 0 }
  const rawStart = Math.max(0, text.length - maxChars)
  const newline = text.indexOf('\n', rawStart)
  const start = newline >= 0 && newline - rawStart <= 240 ? newline + 1 : rawStart
  return {
    text: text.slice(start),
    omittedChars: start,
  }
}

export function sanitizeReasoningForDisplay(text: string): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
  const controlCount = countMatches(normalized, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g)
  const cleaned = normalized
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '')
    .replace(/\t/g, '  ')
  const visibleLength = cleaned.replace(/\s/g, '').length
  if (visibleLength === 0) return ''
  if (controlCount > 0 && controlCount / Math.max(1, text.length) > 0.05) return UNREADABLE_REASONING_TEXT
  if (looksLikeUnreadableReasoning(cleaned)) return UNREADABLE_REASONING_TEXT
  return cleaned
}

function looksLikeUnreadableReasoning(text: string): boolean {
  const visible = text.replace(/\s/g, '')
  if (visible.length < 120) return false
  const letters = countMatches(visible, /[A-Za-z]/g)
  const digits = countMatches(visible, /\d/g)
  const words = text.match(/[A-Za-z]{3,}/g) ?? []
  const wordChars = words.reduce((sum, word) => sum + word.length, 0)
  const whitespace = countMatches(text, /\s/g)
  const symbolDensity = (visible.length - letters - digits) / visible.length
  const wordDensity = wordChars / visible.length
  const whitespaceDensity = whitespace / Math.max(1, text.length)
  return symbolDensity > 0.38 && wordDensity < 0.32 && whitespaceDensity < 0.12
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}
