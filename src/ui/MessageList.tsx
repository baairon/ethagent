import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { ProgressBar } from './ProgressBar.js'

export type MessageRow =
  | { role: 'user'; id: string; content: string }
  | { role: 'assistant'; id: string; content: string; liveTail?: string; streaming?: boolean }
  | { role: 'thinking'; id: string; content: string; liveTail?: string; streaming?: boolean; expanded?: boolean }
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
    }

type MessageListProps = {
  rows: MessageRow[]
}

type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string | null; code: string; open?: boolean }

type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }

const MessageListInner: React.FC<MessageListProps> = ({ rows }) => (
  <Box flexDirection="column">
    {rows.map(row => <RowView key={row.id} row={row} />)}
  </Box>
)

export const MessageList = React.memo(MessageListInner)

export function toggleLatestReasoningRow(rows: MessageRow[]): MessageRow[] {
  let index = -1
  for (let cursor = rows.length - 1; cursor >= 0; cursor -= 1) {
    if (rows[cursor]?.role === 'thinking') {
      index = cursor
      break
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
    const lines = row.content.length === 0 ? [''] : row.content.split('\n')
    return (
      <Box flexDirection="column" marginTop={1}>
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
    const text = reasoningText(row)
    const preview = summarizeThinking(text)
    if (row.expanded) {
      return (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accentPeach} paddingX={1}>
          <Text>
            <Text color={theme.accentPeach} bold>v reasoning</Text>
            <Text color={theme.dim}>  alt+t collapse</Text>
            {row.streaming ? <ThinkingCursor active hasPreview /> : null}
          </Text>
          <ReasoningBody content={text} streaming={row.streaming} />
        </Box>
      )
    }
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={theme.accentPeach} paddingX={1}>
        <Text>
          <Text color={theme.accentPeach} bold>{'> reasoning'}</Text>
          <Text color={theme.dim}>  alt+t inspect</Text>
        </Text>
        <Text color={theme.textSubtle}>
          {preview || 'thinking...'}
          {row.streaming ? <ThinkingCursor active hasPreview={Boolean(preview)} /> : null}
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
        ) : (
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
      <Text color={theme.dim}>{row.status}</Text>
      <ProgressBar progress={row.progress} suffix={row.suffix} />
    </Box>
  )
}

const RowView = React.memo(RowViewInner)

const ReasoningBody: React.FC<{ content: string; streaming?: boolean }> = ({ content, streaming }) => {
  const lines = useMemo(() => {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return normalized.length === 0 ? [''] : normalized.split('\n')
  }, [content])

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} color={theme.textSubtle}>
          {line || ' '}
          {streaming && index === lines.length - 1 ? <ThinkingCursor active hasPreview={line.length > 0} /> : null}
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
  const committedBlocks = useMemo(() => parseMarkdownBlocks(content), [content])
  const tailBlocks = useMemo(() => parseMarkdownBlocks(liveTail ?? ''), [liveTail])

  return (
    <Box flexDirection="column">
      {committedBlocks.map((block, index) => (
        <MarkdownBlockView key={`committed-${index}`} block={block} streaming={false} />
      ))}
      {tailBlocks.map((block, index) => (
        <MarkdownBlockView
          key={`tail-${index}`}
          block={block}
          streaming={streaming && index === tailBlocks.length - 1}
        />
      ))}
      {streaming && committedBlocks.length === 0 && tailBlocks.length === 0 ? (
        <Text color={theme.accentSecondary}>
          <StreamCursor active />
        </Text>
      ) : null}
    </Box>
  )
}

const MarkdownBlockView: React.FC<{ block: MarkdownBlock; streaming?: boolean }> = ({ block, streaming = false }) => {
  if (block.kind === 'heading') {
    const color =
      block.level === 1 ? theme.accentPrimary : block.level === 2 ? theme.accentSecondary : theme.accentMint
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color={color} bold>{block.text}</Text>
      </Box>
    )
  }

  if (block.kind === 'quote') {
    return (
      <Box flexDirection="column" marginTop={1}>
        {block.lines.map((line, index) => (
          <Text key={index}>
            <Text color={theme.accentPeach}>| </Text>
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
            <Text color={theme.accentMint}>{block.ordered ? `${index + 1}. ` : '- '}</Text>
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
        {streaming ? <Text color={theme.accentSecondary}> <StreamCursor active /></Text> : null}
      </Text>
    </Box>
  )
}

const InlineText: React.FC<{ text: string; color: string }> = ({ text, color }) => {
  const tokens = useMemo(() => parseInlineTokens(text), [text])
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === 'bold') {
          return (
            <Text key={index} color={theme.accentNeutral} bold>
              {token.text}
            </Text>
          )
        }
        if (token.kind === 'italic') {
          return (
            <Text key={index} color={theme.accentInfo} italic>
              {token.text}
            </Text>
          )
        }
        if (token.kind === 'code') {
          return (
            <Text key={index} color={theme.accentPeach} backgroundColor="#202020">
              {token.text}
            </Text>
          )
        }
        return (
          <Text key={index} color={color}>
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

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const [, hashes = '#', headingText = ''] = heading
      blocks.push({
        kind: 'heading',
        level: hashes.length as 1 | 2 | 3,
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
      if (nextLine.match(/^(#{1,3})\s+(.*)$/)) break
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
  switch ((lang ?? '').toLowerCase()) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return theme.accentInfo
    case 'json':
      return theme.accentPeach
    case 'html':
    case 'xml':
      return theme.accentPrimary
    case 'css':
    case 'scss':
      return theme.accentLavender
    case 'bash':
    case 'sh':
    case 'zsh':
    case 'powershell':
      return theme.accentMint
    default:
      return theme.border
  }
}

function codeLineColor(lang: string | null, line: string): string {
  const trimmed = line.trim()
  if (!trimmed) return theme.textSubtle
  if ((lang === 'json' || lang === 'jsonc') && /^["[{]/.test(trimmed)) return theme.accentPeach
  if (/^(\/\/|#|\/\*|\*)/.test(trimmed)) return theme.dim
  if (/\b(function|const|let|return|if|else|class|export|import)\b/.test(trimmed)) return theme.text
  if (/<\/?[A-Za-z]/.test(trimmed)) return theme.accentPrimary
  if (/^[.#@]/.test(trimmed)) return theme.accentLavender
  return theme.textSubtle
}

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|\*[^*\n]+?\*|_[^_\n]+?_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }

    const token = match[0]
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      tokens.push({ kind: 'bold', text: token.slice(2, -2) })
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      tokens.push({ kind: 'italic', text: token.slice(1, -1) })
    } else if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ kind: 'code', text: token.slice(1, -1) })
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length || tokens.length === 0) {
    tokens.push({ kind: 'text', text: text.slice(lastIndex) })
  }

  return tokens
}

function summarizeThinking(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117)}...`
}

function reasoningText(row: Extract<MessageRow, { role: 'thinking' }>): string {
  return [row.content, row.liveTail ?? ''].filter(Boolean).join('')
}
