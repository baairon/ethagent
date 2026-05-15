import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from '../ui/theme.js'
import { ProgressBar } from '../ui/ProgressBar.js'
import { Spinner } from '../ui/Spinner.js'
import { DiffView } from './display/DiffView.js'
import { SyntaxLine } from './display/SyntaxText.js'
import { formatToolCall } from './display/toolCallDisplay.js'
import { BrandSplash } from '../ui/BrandSplash.js'
import type { RowSlice } from './transcript/transcriptViewport.js'
import {
  blockContentWidth,
  clipTextForDisplay,
  parseInlineTokens,
  parseMarkdownBlocks,
  sanitizeReasoningForDisplay,
  summarizeThinking,
  type InlineToken,
  type MarkdownBlock,
} from './messageMarkdown.js'

export { sanitizeReasoningForDisplay } from './messageMarkdown.js'

export type ToolCallResult = {
  content: string
  summary: string
  isError: boolean
  diff?: string
}

export type MessageRow =
  | { role: 'user'; id: string; content: string }
  | { role: 'assistant'; id: string; content: string; liveTail?: string; streaming?: boolean }
  | { role: 'thinking'; id: string; content: string; liveTail?: string; streaming?: boolean; expanded?: boolean; showCursor?: boolean }
  | {
      role: 'tool_call'
      id: string
      name: string
      summary: string
      input?: Record<string, unknown>
      result?: ToolCallResult
    }
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
  | {
      role: 'splash'
      id: string
      contextLine?: string
      tipLine?: string
      updateNotice?: string | null
    }

type MessageListProps = {
  slices: Array<RowSlice<MessageRow>>
}

export {
  rowsToFullSlices,
  toggleInspectableRow,
  toggleLatestReasoningRow,
  toggleReasoningRow,
} from './messageRows.js'

const MAX_RENDERED_MESSAGE_CHARS = 12_000
const MAX_RENDERED_REASONING_CHARS = 10_000
const ASSISTANT_ACCENT = theme.accentPeriwinkle
const ASSISTANT_MARKER = '• '

const MessageListInner: React.FC<MessageListProps> = ({ slices }) => (
  <Box flexDirection="column">
    {slices.map((slice, index) => (
      <RowView
        key={slice.row.id}
        slice={slice}
        tightTop={slice.row.role === 'tool_call' && slices[index - 1]?.row.role === 'tool_call'}
      />
    ))}
  </Box>
)

export const MessageList = React.memo(MessageListInner)

const RowViewInner: React.FC<{ slice: RowSlice<MessageRow>; tightTop?: boolean }> = ({ slice, tightTop }) => {
  const { row, clipStart, clipEnd, rowHeight } = slice
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
            <Text color={i === 0 ? theme.accentPeriwinkle : theme.dim}>{i === 0 ? '> ' : '  '}</Text>
            <Text color={theme.textSubtle}>{line}</Text>
          </Text>
        ))}
      </Box>
    )
  }

  if (row.role === 'assistant') {
    const showTopMargin = clipStart === 0
    const bodyClipStart = showTopMargin ? 0 : clipStart - 1
    const bodyClipEnd = clipEnd !== undefined ? Math.max(0, clipEnd - 1) : undefined
    return (
      <Box flexDirection="column" marginTop={showTopMargin ? 1 : 0}>
        <AssistantBody
          content={row.content}
          liveTail={row.liveTail}
          streaming={row.streaming}
          clipStart={bodyClipStart}
          clipEnd={bodyClipEnd}
        />
      </Box>
    )
  }

  if (row.role === 'thinking') {
    const text = sanitizeReasoningForDisplay(reasoningText(row))
    const preview = summarizeThinking(text)
    const active = Boolean(row.streaming)
    const showCursor = reasoningCursorVisible(row)
    if (row.expanded) {
      return (
        <ReasoningBlock
          content={text}
          detail="alt+t collapse"
          expanded
          active={active}
          showCursor={showCursor}
          clipStart={clipStart}
          clipEnd={clipEnd}
          rowHeight={rowHeight}
        />
      )
    }
    return (
      <ReasoningBlock
        content={preview || 'thinking...'}
        detail="alt+t inspect"
        active={active}
        showCursor={showCursor}
        clipStart={clipStart}
        clipEnd={clipEnd}
        rowHeight={rowHeight}
      />
    )
  }

  if (row.role === 'tool_call') {
    const { displayName, argSummary } = formatToolCall(row.name, row.input)
    const result = row.result
    const showResultLine = !result || result.isError
    return (
      <Box flexDirection="column" marginTop={tightTop ? 0 : 1}>
        <Text>
          <Text color={theme.dim}>{'● '}</Text>
          <Text color={theme.accentPeriwinkle} bold>{displayName}</Text>
          {row.name !== 'run_bash' && argSummary ? <Text color={theme.textSubtle}>{` ${argSummary}`}</Text> : null}
          {result && !result.isError ? <Text color={theme.dim}>{' done'}</Text> : null}
        </Text>
        {row.name === 'run_bash' && argSummary ? (
          <Box marginLeft={2}>
            <Text>
              <Text color={theme.dim}>{'$ '}</Text>
              <Text color={theme.text}>{argSummary}</Text>
            </Text>
          </Box>
        ) : null}
        {showResultLine ? (
          result ? (
            <Box marginLeft={2}>
              <Text color={result.isError ? theme.accentError : theme.dim}>{result.summary}</Text>
            </Box>
          ) : (
            <Box marginLeft={2}>
              <Text color={theme.dim}>running…</Text>
            </Box>
          )
        ) : null}
        {result?.diff && !result.isError ? (
          <Box flexDirection="column" marginLeft={2}>
            <DiffView diff={result.diff} />
          </Box>
        ) : null}
      </Box>
    )
  }

  if (row.role === 'note') {
    const color = row.kind === 'error' ? theme.accentError : row.kind === 'dim' ? theme.dim : theme.accentPeriwinkle
    return (
      <Box marginTop={1}>
        <Text color={color}>{row.content}</Text>
      </Box>
    )
  }

  if (row.role === 'splash') {
    return (
      <BrandSplash
        contextLine={row.contextLine}
        tipLine={row.tipLine}
        updateNotice={row.updateNotice ?? null}
      />
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.accentPeriwinkle} bold>{row.title}</Text>
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

const ShimmerText: React.FC<{
  text: string
  color: string
  active?: boolean
  bold?: boolean
  italic?: boolean
}> = ({ text, color, active = false, bold, italic }) => {
  const [position, setPosition] = useState(0)

  useEffect(() => {
    if (!active) return
    const period = text.length + 8
    const timer = setInterval(() => {
      setPosition(prev => (prev + 1) % period)
    }, 90)
    return () => clearInterval(timer)
  }, [active, text.length])

  if (!active) {
    return <Text color={color} bold={bold} italic={italic}>{text}</Text>
  }

  const shimmerStart = position - 1
  const shimmerEnd = position + 1
  const visibleStart = Math.max(0, shimmerStart)
  const visibleEnd = Math.min(text.length, shimmerEnd + 1)
  const before = text.slice(0, visibleStart)
  const shimmer = shimmerStart < text.length && shimmerEnd >= 0 ? text.slice(visibleStart, visibleEnd) : ''
  const after = text.slice(visibleEnd)

  return (
    <>
      {before ? <Text color={color} bold={bold} italic={italic}>{before}</Text> : null}
      {shimmer ? <Text color={theme.accentWhite} bold italic={italic}>{shimmer}</Text> : null}
      {after ? <Text color={color} bold={bold} italic={italic}>{after}</Text> : null}
    </>
  )
}

export function reasoningBorderColor(row: Extract<MessageRow, { role: 'thinking' }>): string {
  return row.streaming ? theme.accentPeriwinkle : theme.border
}

export function reasoningCursorVisible(row: Extract<MessageRow, { role: 'thinking' }>): boolean {
  return Boolean(row.streaming && row.showCursor)
}

const ReasoningBlock: React.FC<{
  content: string
  detail: string
  active?: boolean
  expanded?: boolean
  showCursor?: boolean
  clipStart?: number
  clipEnd?: number
  rowHeight?: number
}> = ({ content, detail, active = false, expanded = false, showCursor, clipStart = 0, clipEnd, rowHeight }) => {
  const display = useMemo(
    () => clipTextForDisplay(content, MAX_RENDERED_REASONING_CHARS),
    [content],
  )
  const lines = useMemo(() => {
    const normalized = display.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    return normalized.length === 0 ? [''] : normalized.split('\n')
  }, [display.text])

  const omittedVisible = display.omittedChars > 0
  const totalLines = rowHeight ?? (1 + (omittedVisible ? 1 : 0) + 1 + (expanded ? lines.length : 0))
  const effClipEnd = clipEnd ?? totalLines

  const lineInClip = (n: number) => n >= clipStart && n < effClipEnd
  const showMargin = lineInClip(0)
  const omittedLine = 1
  const headerLine = omittedVisible ? 2 : 1
  const bodyStartLine = headerLine + 1

  const lastBodyIndex = lines.length - 1
  const visibleBody: Array<{ index: number; text: string }> = []
  if (expanded) {
    for (let i = 0; i < lines.length; i += 1) {
      const ln = bodyStartLine + i
      if (ln >= effClipEnd) break
      if (ln < clipStart) continue
      visibleBody.push({ index: i, text: lines[i] ?? '' })
    }
  }

  return (
    <Box flexDirection="column" marginTop={showMargin ? 1 : 0}>
      {omittedVisible && lineInClip(omittedLine) ? (
        <Text color={theme.dim}>{`${display.omittedChars} earlier reasoning characters omitted`}</Text>
      ) : null}
      {lineInClip(headerLine) ? (
        <Text>
          <AssistantMarker />
          <ShimmerText
            text={expanded ? 'Thinking…' : 'Thinking'}
            color={theme.accentPeriwinkle}
            active={active}
            bold
            italic
          />
          <Text color={theme.dim}>{` · ${detail}`}</Text>
          {!expanded && showCursor ? <ThinkingCursor active hasPreview /> : null}
        </Text>
      ) : null}
      {expanded && visibleBody.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {visibleBody.map(({ index, text }) => (
            <Box key={index}>
              <Text color={theme.textSubtle}>
                <Text color={theme.dim}>{'  '}</Text>
                {text || ' '}
                {showCursor && index === lastBodyIndex ? <ThinkingCursor active hasPreview={text.length > 0} /> : null}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

const AssistantBody: React.FC<{
  content: string
  liveTail?: string
  streaming?: boolean
  clipStart?: number
  clipEnd?: number
}> = ({ content, liveTail, streaming, clipStart = 0, clipEnd }) => {
  const fullText = liveTail ? content + liveTail : content
  const nodes = useMemo(
    () => flattenAssistantBody(fullText, Boolean(streaming)),
    [fullText, streaming],
  )
  const effClipEnd = clipEnd ?? nodes.length
  const visible = nodes.slice(clipStart, effClipEnd)
  return (
    <Box flexDirection="column">
      {visible.map((node, i) => (
        <React.Fragment key={clipStart + i}>{node}</React.Fragment>
      ))}
    </Box>
  )
}

export function flattenAssistantBody(fullText: string, streaming: boolean): React.ReactNode[] {
  const display = clipTextForDisplay(fullText, MAX_RENDERED_MESSAGE_CHARS)
  const blocks = parseMarkdownBlocks(display.text)
  const nodes: React.ReactNode[] = []

  if (display.omittedChars > 0) {
    nodes.push(
      <Text color={theme.dim}>{`${display.omittedChars} earlier characters omitted`}</Text>,
    )
  }

  if (blocks.length === 0) {
    if (streaming) {
      nodes.push(
        <Text>
          <AssistantMarker />
          <Text color={ASSISTANT_ACCENT}><StreamCursor active /></Text>
        </Text>,
      )
    }
    return nodes
  }

  for (let bi = 0; bi < blocks.length; bi += 1) {
    const block = blocks[bi]!
    const isLastBlock = bi === blocks.length - 1
    const prefix = bi === 0 || block.kind === 'code' ? <AssistantMarker /> : null
    const streamingLast = streaming && isLastBlock

    nodes.push(<Text> </Text>)

    if (block.kind === 'heading') {
      nodes.push(
        <Text>
          {prefix}
          <InlineText text={block.text} color={ASSISTANT_ACCENT} bold />
        </Text>,
      )
      continue
    }

    if (block.kind === 'quote') {
      block.lines.forEach((line, li) => {
        nodes.push(
          <Text>
            {li === 0 ? prefix : null}
            <Text color={ASSISTANT_ACCENT}>| </Text>
            <InlineText text={line} color={theme.dim} />
          </Text>,
        )
      })
      continue
    }

    if (block.kind === 'list') {
      block.items.forEach((item, li) => {
        nodes.push(
          <Text>
            {li === 0 ? prefix : null}
            <Text color={ASSISTANT_ACCENT}>{block.ordered ? `${li + 1}. ` : '- '}</Text>
            <InlineText text={item} color={theme.text} />
          </Text>,
        )
      })
      continue
    }

    if (block.kind === 'code') {
      nodes.push(
        <Text>
          {prefix}
          <Text color={theme.accentPeriwinkle} bold>{block.lang ?? 'code'}</Text>
          {block.open ? <Text color={theme.dim}> streaming</Text> : null}
        </Text>,
      )
      const codeLines = block.code.length === 0 ? [''] : block.code.split('\n')
      const isShell = block.lang === 'bash' || block.lang === 'sh'
      codeLines.forEach((line, li) => {
        const isLastCode = li === codeLines.length - 1
        nodes.push(
          <Text>
            <Text color={theme.dim}>{`  ${isShell ? '$ ' : '  '}`}</Text>
            <SyntaxLine line={line} lang={block.lang} fallbackColor={theme.textSubtle} />
            {block.open && isLastCode ? <Text color={ASSISTANT_ACCENT}> <StreamCursor active /></Text> : null}
          </Text>,
        )
      })
      continue
    }

    const paragraphLines = block.text.split('\n')
    paragraphLines.forEach((line, li) => {
      const isLastLine = li === paragraphLines.length - 1
      nodes.push(
        <Text>
          {li === 0 ? prefix : null}
          <InlineText text={line} color={theme.text} />
          {streamingLast && isLastLine ? <Text color={ASSISTANT_ACCENT}> <StreamCursor active /></Text> : null}
        </Text>,
      )
    })
  }

  return nodes
}

const AssistantMarker: React.FC = () => (
  <Text color={theme.dim}>{ASSISTANT_MARKER}</Text>
)

const MarkdownBlockView: React.FC<{ block: MarkdownBlock; streaming?: boolean; prefix?: React.ReactNode }> = ({
  block,
  streaming = false,
  prefix = null,
}) => {
  if (block.kind === 'heading') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {prefix}
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
            {index === 0 ? prefix : null}
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
            {index === 0 ? prefix : null}
            <Text color={ASSISTANT_ACCENT}>{block.ordered ? `${index + 1}. ` : '- '}</Text>
            <InlineText text={item} color={theme.text} />
          </Text>
        ))}
      </Box>
    )
  }

  if (block.kind === 'code') {
    const lines = block.code.length === 0 ? [''] : block.code.split('\n')
    const isShell = block.lang === 'bash' || block.lang === 'sh'
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>
          {prefix}
          <Text color={theme.accentPeriwinkle} bold>{block.lang ?? 'code'}</Text>
          {block.open ? <Text color={theme.dim}> streaming</Text> : null}
        </Text>
        <Box flexDirection="column" marginLeft={2}>
          {lines.map((line, index) => (
            <Text key={index}>
              <Text color={theme.dim}>{isShell ? '$ ' : '  '}</Text>
              <SyntaxLine line={line} lang={block.lang} fallbackColor={theme.textSubtle} />
              {block.open && index === lines.length - 1 ? <Text color={ASSISTANT_ACCENT}> <StreamCursor active /></Text> : null}
            </Text>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        {prefix}
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
    <Text color={theme.accentPeriwinkle}>
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

function reasoningText(row: Extract<MessageRow, { role: 'thinking' }>): string {
  return row.liveTail ? row.content + row.liveTail : row.content
}
