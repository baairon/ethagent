import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../ui/theme.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { Spinner } from '../ui/Spinner.js'
import { hidesSuccessfulToolResultContent } from './toolResultDisplay.js'

export type MessageRow =
  | { role: 'user'; id: string; content: string }
  | { role: 'assistant'; id: string; content: string; liveTail?: string; streaming?: boolean }
  | { role: 'thinking'; id: string; content: string; liveTail?: string; streaming?: boolean; expanded?: boolean; showCursor?: boolean }
  | { role: 'tool_use'; id: string; name: string; summary: string; input?: string }
  | { role: 'tool_result'; id: string; name: string; summary: string; content: string; isError?: boolean }
  | { role: 'note'; id: string; kind: 'info' | 'error' | 'dim'; content: string }
  | {
      role: 'progress'
      id: string
      title: string
      progress: number
      status: string
      suffix?: string
      done?: boolean
      indeterminate?: boolean
      startedAt?: number
    }

type MessageListProps = {
  rows: MessageRow[]
}

type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string | null; code: string; open?: boolean }

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }

const MAX_RENDERED_MESSAGE_CHARS = 12_000
const MAX_RENDERED_REASONING_CHARS = 10_000
const ASSISTANT_ACCENT = theme.accentMint
const UNREADABLE_REASONING_TEXT = 'reasoning output was not readable text'

const MessageListInner: React.FC<MessageListProps> = ({ rows }) => (
  <Box flexDirection="column">
    {rows.map(row => <RowView key={row.id} row={row} />)}
  </Box>
)

export const MessageList = React.memo(MessageListInner)

export function toggleLatestReasoningRow(rows: MessageRow[]): MessageRow[] {
  return toggleReasoningRow(rows)
}

export function toggleReasoningRow(rows: MessageRow[], rowId?: string): MessageRow[] {
  let index = -1
  if (rowId) {
    index = rows.findIndex(row => row.id === rowId && row.role === 'thinking')
  }
  if (index === -1) {
    for (let cursor = rows.length - 1; cursor >= 0; cursor -= 1) {
      if (rows[cursor]?.role === 'thinking') {
        index = cursor
        break
      }
    }
  }
  if (index === -1) return rows
  const row = rows[index]
  if (!row || row.role !== 'thinking') return rows
  const next = rows.slice()
  next[index] = { ...row, expanded: !row.expanded }
  return next
}

const RowViewInner: React.FC<{ row: MessageRow }> = ({ row }) => {
  if (row.role === 'user') {
    const display = clipTextForDisplay(row.content, MAX_RENDERED_MESSAGE_CHARS)
    const lines = display.text.length === 0 ? [''] : display.text.split('\n')
    return (
      <Box flexDirection="column" marginTop={1}>
        {display.omittedChars > 0 ? (
          <Text color={theme.dim}>{`  ${display.omittedChars} earlier characters omitted`}</Text>
        ) : null}
        {lines.map((line, i) => (
          <Text key={i}>
            <Text color={i === 0 ? theme.accentMint : theme.dim}>{i === 0 ? '> ' : '  '}</Text>
            <Text color={theme.textSubtle}>{line}</Text>
          </Text>
        ))}
      </Box>
    )
  }

  if (row.role === 'assistant') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <AssistantBody content={row.content} liveTail={row.liveTail} streaming={row.streaming} />
      </Box>
    )
  }

  if (row.role === 'thinking') {
    const text = sanitizeReasoningForDisplay(reasoningText(row))
    const preview = summarizeThinking(text)
    const borderColor = reasoningBorderColor(row)
    const showCursor = reasoningCursorVisible(row)
    if (row.expanded) {
      return (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
          <Text>
            <Text color={theme.accentPeach} bold>reasoning</Text>
            <Text color={theme.dim}> · expanded · alt+t collapse</Text>
          </Text>
          <ReasoningBody content={text} showCursor={showCursor} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
        <Text>
          <Text color={theme.accentPeach} bold>reasoning</Text>
          <Text color={theme.dim}> · collapsed · alt+t inspect</Text>
        </Text>
        <Text color={theme.textSubtle}>
          {preview || 'thinking...'}
          {showCursor ? <ThinkingCursor active hasPreview={Boolean(preview)} /> : null}
        </Text>
      </Box>
    )
  }

  if (row.role === 'tool_use') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.border} paddingX={1}>
        <Text color={theme.accentNeutral} bold>{`tool · ${row.name}`}</Text>
        <Text color={theme.dim}>{row.summary}</Text>
        {row.input ? <Text color={theme.textSubtle}>{row.input}</Text> : null}
      </Box>
    )
  }

  if (row.role === 'tool_result') {
    const hideContent = hidesSuccessfulToolResultContent(row.name, row.isError)
    return (
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={row.isError ? '#a84c4c' : theme.border}
        paddingX={1}
      >
        <Text color={row.isError ? '#e87070' : theme.accentSecondary} bold>{`result · ${row.name}`}</Text>
        <Text color={theme.dim}>{row.summary}</Text>
        {row.isError ? (
          <Text color="#f1b0b0">{row.content}</Text>
        ) : hideContent || !row.content ? null : (
          <AssistantBody content={row.content} />
        )}
      </Box>
    )
  }

  if (row.role === 'note') {
    const color = row.kind === 'error' ? '#e87070' : row.kind === 'dim' ? theme.dim : theme.accentInfo
    return (
      <Box marginTop={1}>
        <Text color={color}>{row.content}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.accentMint} bold>{row.title}</Text>
      {row.indeterminate ? (
        <ProgressSpinner row={row} />
      ) : (
        <>
          <Text color={theme.dim}>{row.status}</Text>
          <ProgressBar progress={row.progress} suffix={row.suffix} />
        </>
      )}
    </Box>
  )
}

const RowView = React.memo(RowViewInner)

const ProgressSpinner: React.FC<{ row: Extract<MessageRow, { role: 'progress' }> }> = ({ row }) => {
  return <Spinner active label={row.status} hint={row.suffix} startedAt={row.startedAt} />
}

export function reasoningBorderColor(row: Extract<MessageRow, { role: 'thinking' }>): string {
  return row.streaming ? theme.accentPeach : theme.border
}

export function reasoningCursorVisible(row: Extract<MessageRow, { role: 'thinking' }>): boolean {
  return Boolean(row.streaming && row.showCursor)
}

const ReasoningBody: React.FC<{ content: string; showCursor?: boolean }> = ({ content, showCursor }) => {
  const display = useMemo(
    () => clipTextForDisplay(content, MAX_RENDERED_REASONING_CHARS),
    [content],
  )
  const lines = useMemo(() => {
    const normalized = display.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return normalized.length === 0 ? [''] : normalized.split('\n')
  }, [display.text])

  return (
    <Box flexDirection="column">
      {display.omittedChars > 0 ? (
        <Text color={theme.dim}>{`${display.omittedChars} earlier reasoning characters omitted`}</Text>
      ) : null}
      {lines.map((line, index) => (
        <Text key={index} color={theme.textSubtle}>
          {line || ' '}
          {showCursor && index === lines.length - 1 ? <ThinkingCursor active hasPreview={line.length > 0} /> : null}
        </Text>
      ))}
    </Box>
  )
}

const AssistantBody: React.FC<{ content: string; liveTail?: string; streaming?: boolean }> = ({
  content,
  liveTail,
  streaming,
}) => {
  const fullText = liveTail ? content + liveTail : content
  const display = useMemo(
    () => clipTextForDisplay(fullText, MAX_RENDERED_MESSAGE_CHARS),
    [fullText],
  )
  const blocks = useMemo(() => parseMarkdownBlocks(display.text), [display.text])

  return (
    <Box flexDirection="column">
      {display.omittedChars > 0 ? (
        <Text color={theme.dim}>{`${display.omittedChars} earlier characters omitted`}</Text>
      ) : null}
      {blocks.map((block, index) => (
        <MarkdownBlockView
          key={index}
          block={block}
          streaming={streaming && index === blocks.length - 1}
        />
      ))}
      {streaming && blocks.length === 0 ? (
        <Text color={ASSISTANT_ACCENT}>
          <StreamCursor active />
        </Text>
      ) : null}
    </Box>
  )
}

const MarkdownBlockView: React.FC<{ block: MarkdownBlock; streaming?: boolean }> = ({ block, streaming = false }) => {
  if (block.kind === 'heading') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <InlineText text={block.text} color={ASSISTANT_ACCENT} bold />
        </Text>
      </Box>
    )
  }

  if (block.kind === 'quote') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {block.lines.map((line, index) => (
          <Text key={index}>
            <Text color={ASSISTANT_ACCENT}>| </Text>
            <InlineText text={line} color={theme.dim} />
          </Text>
        ))}
      </Box>
    )
  }

  if (block.kind === 'list') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {block.items.map((item, index) => (
          <Text key={index}>
            <Text color={ASSISTANT_ACCENT}>{block.ordered ? `${index + 1}. ` : '- '}</Text>
            <InlineText text={item} color={theme.text} />
          </Text>
        ))}
      </Box>
    )
  }

  if (block.kind === 'code') {
    const lines = block.code.length === 0 ? [''] : block.code.split('\n')
    const accent = codeAccent(block.lang)
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={accent}>
        <Box paddingX={1}>
          <Text color={accent} bold>{block.lang ? block.lang : 'code'}</Text>
          <Text color={theme.dim}>{block.open ? '  · streaming' : '  · block'}</Text>
        </Box>
        <Box flexDirection="column" paddingX={1}>
          {lines.map((line, index) => (
            <Text key={index}>
              <Text color={theme.dim}>{`${String(index + 1).padStart(2, '0')} `}</Text>
              <Text color={codeLineColor(block.lang, line)}>{line || ' '}</Text>
            </Text>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <InlineText text={block.text} color={theme.text} />
        {streaming ? <Text color={ASSISTANT_ACCENT}> <StreamCursor active /></Text> : null}
      </Text>
    </Box>
  )
}

const InlineText: React.FC<{ text: string; color: string; bold?: boolean }> = ({ text, color, bold }) => {
  const tokens = useMemo(() => parseInlineTokens(text), [text])
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'bold') {
          return (
            <Text key={index} color={ASSISTANT_ACCENT} bold>
              {token.text}
            </Text>
          )
        }
        if (token.kind === 'italic') {
          return (
            <Text key={index} color={ASSISTANT_ACCENT} italic>
              {token.text}
            </Text>
          )
        }
        if (token.kind === 'code') {
          return (
            <Text key={index} color={ASSISTANT_ACCENT} backgroundColor="#202020">
              {token.text}
            </Text>
          )
        }
        return (
          <Text key={index} color={color} bold={bold}>
            {token.text}
          </Text>
        )
      })}
    </>
  )
}

const ThinkingCursor: React.FC<{ active: boolean; hasPreview: boolean }> = ({ active, hasPreview }) => {
  if (!active) return null
  return (
    <Text color={theme.accentPeach}>
      {hasPreview ? ' ' : ''}
      <StreamCursor active />
    </Text>
  )
}

const StreamCursor: React.FC<{ active: boolean }> = ({ active }) => {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      setVisible(v => !v)
    }, 420)
    return () => clearInterval(timer)
  }, [active])

  return <>{visible ? '|' : ' '}</>
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
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

function codeAccent(lang: string | null): string {
  return ASSISTANT_ACCENT
}

function codeLineColor(lang: string | null, line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return theme.textSubtle
  if ((lang === 'json' || lang === 'jsonc') && /^["[{]/.test(trimmed)) return ASSISTANT_ACCENT
  if (/^(\/\/|#|\/\*|\*)/.test(trimmed)) return theme.dim
  if (/\b(function|const|let|return|if|else|class|export|import)\b/.test(trimmed)) return theme.text
  if (/<\/?[A-Za-z]/.test(trimmed)) return ASSISTANT_ACCENT
  if (/^[.#@]/.test(trimmed)) return ASSISTANT_ACCENT
  return theme.textSubtle
}

function parseInlineTokens(text: string): InlineToken[] {
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

function summarizeThinking(text: string): string {
  const sample = text.length > 1000 ? text.slice(-1000) : text
  const normalized = sample.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const prefix = text.length > sample.length ? '...' : ''
  if (normalized.length + prefix.length <= 120) return `${prefix}${normalized}`
  return `${prefix}${normalized.slice(Math.max(0, normalized.length - (120 - prefix.length)))}`
}

function clipTextForDisplay(text: string, maxChars: number): { text: string; omittedChars: number } {
  if (text.length <= maxChars) return { text, omittedChars: 0 }
  const rawStart = Math.max(0, text.length - maxChars)
  const newline = text.indexOf('\n', rawStart)
  const start = newline >= 0 && newline - rawStart <= 240 ? newline + 1 : rawStart
  return {
    text: text.slice(start),
    omittedChars: start,
  }
}

function reasoningText(row: Extract<MessageRow, { role: 'thinking' }>): string {
  return row.liveTail ? row.content + row.liveTail : row.content
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
