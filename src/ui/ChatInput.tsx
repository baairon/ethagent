import fs from 'node:fs/promises'
import path from 'node:path'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme } from './theme.js'
import { readClipboardImage } from '../utils/clipboard.js'
import { useAppInput } from '../input/AppInputProvider.js'
import type { SlashSuggestion } from '../commands/index.js'
import {
  beginHistoryPreview,
  canNavigateHistory as canNavigateHistoryState,
  deleteToLineStart,
  emptyBuffer,
  exitHistoryPreview,
  detectActiveFileMention,
  moveThroughHistory,
  moveVerticalVisual,
  replaceActiveFileMention,
  type ChatBuffer,
  type FileMentionToken,
} from './chatInputState.js'
import {
  getVisibleVisualLineWindow,
  getVisualLineIndex,
  getVisualLines,
} from './textCursor.js'
import {
  countPastedTextLineBreaks,
  expandPastedTextRefs,
  formatPastedTextRef,
  LARGE_PASTE_THRESHOLD,
  normalizePastedText,
  shouldCollapsePastedText,
  type PastedTextRef,
} from './chatPaste.js'

type PromptInputProps = {
  onSubmit: (value: string) => void
  history: string[]
  disabled?: boolean
  placeholderHints?: string[]
  queuedMessages?: string[]
  prefix?: string
  slashSuggestions?: SlashSuggestion[]
  mode?: 'prompt' | 'bash'
  onModeChange?: (mode: 'prompt' | 'bash') => void
  footerRight?: React.ReactNode
  cwd?: string
}

const MAX_LENGTH = 32_768
const PLACEHOLDER_ROTATE_MS = 8000
const PASTE_BURST_MS = 100
const PASTE_FLUSH_LIMIT = 4096
const MIN_INPUT_VIEWPORT_LINES = 3
const PROMPT_FOOTER_LINES = 5
const MAX_INLINE_PASTE_LINES = 2

export const ChatInput: React.FC<PromptInputProps> = ({
  onSubmit,
  history,
  disabled,
  placeholderHints,
  queuedMessages = [],
  prefix = '\u203a',
  slashSuggestions = [],
  mode = 'prompt',
  onModeChange,
  footerRight,
  cwd,
}) => {
  const { stdout } = useStdout()
  const [buffer, setBuffer] = useState<ChatBuffer>(emptyBuffer)
  const { value, cursor } = buffer
  const [columns, setColumns] = useState<number>(() => stdout.columns ?? process.stdout.columns ?? 80)
  const [rows, setRows] = useState<number>(() => stdout.rows ?? process.stdout.rows ?? 24)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draftBuffer, setDraftBuffer] = useState<ChatBuffer>(emptyBuffer)
  const [historyPreviewActive, setHistoryPreviewActive] = useState(false)
  const [preferredColumn, setPreferredColumn] = useState<number | null>(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [suggestionIdx, setSuggestionIdx] = useState(0)
  const [fileSuggestionIdx, setFileSuggestionIdx] = useState(0)
  const [fileSuggestions, setFileSuggestions] = useState<FileMentionSuggestion[]>([])

  const bufferRef = useRef<ChatBuffer>(buffer)
  const historyIndexRef = useRef<number | null>(historyIndex)
  const draftBufferRef = useRef<ChatBuffer>(draftBuffer)
  const historyPreviewActiveRef = useRef(historyPreviewActive)
  const preferredColumnRef = useRef<number | null>(preferredColumn)
  const pasteBufferRef = useRef('')
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pastedTextRefsRef = useRef<Map<number, PastedTextRef>>(new Map())
  const nextPastedTextRefIdRef = useRef(1)

  useEffect(() => { bufferRef.current = buffer }, [buffer])
  useEffect(() => { historyIndexRef.current = historyIndex }, [historyIndex])
  useEffect(() => { draftBufferRef.current = draftBuffer }, [draftBuffer])
  useEffect(() => { historyPreviewActiveRef.current = historyPreviewActive }, [historyPreviewActive])
  useEffect(() => { preferredColumnRef.current = preferredColumn }, [preferredColumn])

  useEffect(() => {
    const handleResize = () => {
      setColumns(stdout.columns ?? process.stdout.columns ?? 80)
      setRows(stdout.rows ?? process.stdout.rows ?? 24)
    }
    stdout.on('resize', handleResize)
    return () => {
      stdout.off('resize', handleResize)
    }
  }, [stdout])

  const applyBuffer = useCallback((next: ChatBuffer) => {
    bufferRef.current = next
    setBuffer(next)
  }, [])

  const applyHistoryState = useCallback((next: {
    historyIndex: number | null
    historyPreviewActive: boolean
    draftBuffer: ChatBuffer
    preferredColumn: number | null
  }) => {
    historyIndexRef.current = next.historyIndex
    draftBufferRef.current = next.draftBuffer
    historyPreviewActiveRef.current = next.historyPreviewActive
    preferredColumnRef.current = next.preferredColumn
    setHistoryIndex(next.historyIndex)
    setDraftBuffer(next.draftBuffer)
    setHistoryPreviewActive(next.historyPreviewActive)
    setPreferredColumn(next.preferredColumn)
  }, [])

  const applyTextEdit = useCallback((next: ChatBuffer) => {
    bufferRef.current = next
    setBuffer(next)
    applyHistoryState(exitHistoryPreview(next))
  }, [applyHistoryState])

  useEffect(() => {
    if (!placeholderHints || placeholderHints.length < 2) return
    const timer = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % placeholderHints.length)
    }, PLACEHOLDER_ROTATE_MS)
    return () => clearInterval(timer)
  }, [placeholderHints])

  const showingSlash = value.startsWith('/') && !value.includes(' ') && slashSuggestions.length > 0
  const activeFileMention = useMemo(() => detectActiveFileMention(value, cursor), [value, cursor])
  const showingFiles = Boolean(activeFileMention && cwd && fileSuggestions.length > 0)
  const filteredSuggestions = useMemo(() => {
    if (!showingSlash) return []
    const prefixValue = value.slice(1).toLowerCase()
    return slashSuggestions.filter(s => s.name.toLowerCase().startsWith(prefixValue)).slice(0, 6)
  }, [showingSlash, value, slashSuggestions])

  useEffect(() => {
    if (suggestionIdx >= filteredSuggestions.length) setSuggestionIdx(0)
  }, [filteredSuggestions.length, suggestionIdx])

  useEffect(() => {
    if (!activeFileMention || !cwd) {
      setFileSuggestions([])
      setFileSuggestionIdx(0)
      return
    }
    let cancelled = false
    void (async () => {
      const suggestions = await listFileMentionSuggestions(cwd, activeFileMention)
      if (cancelled) return
      setFileSuggestions(suggestions)
      setFileSuggestionIdx(0)
    })()
    return () => { cancelled = true }
  }, [activeFileMention?.query, activeFileMention?.start, cwd])

  const insertText = useCallback((text: string) => {
    const prev = bufferRef.current
    const nextValue = (prev.value.slice(0, prev.cursor) + text + prev.value.slice(prev.cursor)).slice(0, MAX_LENGTH)
    const nextCursor = Math.min(prev.cursor + text.length, nextValue.length)
    applyTextEdit({ value: nextValue, cursor: nextCursor })
  }, [applyTextEdit])

  const completeFileMention = useCallback(() => {
    const picked = fileSuggestions[fileSuggestionIdx]
    if (!picked) return false
    const next = replaceActiveFileMention(bufferRef.current, picked.path)
    applyTextEdit(next)
    setPreferredColumn(null)
    return true
  }, [applyTextEdit, fileSuggestionIdx, fileSuggestions])

  const resetBuffer = useCallback(() => {
    applyBuffer(emptyBuffer())
    applyHistoryState({
      historyIndex: null,
      historyPreviewActive: false,
      draftBuffer: emptyBuffer(),
      preferredColumn: null,
    })
    pastedTextRefsRef.current.clear()
    nextPastedTextRefIdRef.current = 1
  }, [applyBuffer, applyHistoryState])

  const handlePaste = useCallback((text: string) => {
    const normalized = normalizePastedText(text)
    if (shouldCollapsePastedText(normalized, MAX_INLINE_PASTE_LINES)) {
      const id = nextPastedTextRefIdRef.current++
      pastedTextRefsRef.current.set(id, { id, content: normalized })
      insertText(formatPastedTextRef(id, normalized.length))
      return
    }
    insertText(normalized)
  }, [insertText])

  const flushPasteBuffer = useCallback(() => {
    if (pasteTimerRef.current) {
      clearTimeout(pasteTimerRef.current)
      pasteTimerRef.current = null
    }
    const text = pasteBufferRef.current
    pasteBufferRef.current = ''
    if (text) handlePaste(text)
  }, [handlePaste])

  const enqueuePasteChunk = useCallback((text: string) => {
    pasteBufferRef.current += text
    if (pasteBufferRef.current.length >= PASTE_FLUSH_LIMIT) {
      flushPasteBuffer()
      return
    }
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current)
    pasteTimerRef.current = setTimeout(flushPasteBuffer, PASTE_BURST_MS)
  }, [flushPasteBuffer])

  useEffect(() => () => {
    if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current)
  }, [])

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(expandPastedTextRefs(trimmed, pastedTextRefsRef.current))
    resetBuffer()
  }, [value, onSubmit, resetBuffer])

  const canNavigateHistory = useCallback(() => {
    return canNavigateHistoryState(
      bufferRef.current,
      history.length,
      historyIndexRef.current,
      historyPreviewActiveRef.current,
    )
  }, [history.length])

  const showPreviousHistory = useCallback((force = false) => {
    if (!force && !canNavigateHistory()) return
    if (history.length === 0) return
    const currentBuffer = bufferRef.current
    const currentHistoryIndex = historyIndexRef.current
    const currentDraftBuffer = draftBufferRef.current
    const currentPreferredColumn = preferredColumnRef.current
    if (currentHistoryIndex === null) {
      const next = beginHistoryPreview(currentBuffer, history, -1, currentPreferredColumn)
      if (!next) return
      applyHistoryState(next.preview)
      applyBuffer(next.buffer)
      return
    }
    const next = moveThroughHistory(history, currentHistoryIndex, -1, currentDraftBuffer, currentPreferredColumn)
    applyHistoryState(next.preview)
    applyBuffer(next.buffer)
  }, [applyBuffer, applyHistoryState, canNavigateHistory, history])

  const showNextHistory = useCallback((force = false) => {
    const currentHistoryIndex = historyIndexRef.current
    if (!force && currentHistoryIndex === null) return
    if (currentHistoryIndex === null) return
    const next = moveThroughHistory(
      history,
      currentHistoryIndex,
      1,
      draftBufferRef.current,
      preferredColumnRef.current,
    )
    applyHistoryState(next.preview)
    applyBuffer(next.buffer)
  }, [applyBuffer, applyHistoryState, history])

  const wrapWidth = Math.max(20, columns - 8)
  const maxVisibleInputLines = Math.max(MIN_INPUT_VIEWPORT_LINES, Math.floor(rows / 2) - PROMPT_FOOTER_LINES)

  useAppInput((input, key, event) => {
    if (disabled) return

    const pastePending = pasteTimerRef.current !== null
    if (event.isPasted || pastePending || isFallbackPasteInput(input)) {
      if (input) enqueuePasteChunk(input)
      return
    }
    const inputText = input

    const wantsSoftBreak = isSoftBreak(key)

    if (showingFiles) {
      if (key.tab || (key.return && !wantsSoftBreak)) {
        if (completeFileMention()) return
      }
      if (key.upArrow) {
        setFileSuggestionIdx(i => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setFileSuggestionIdx(i => Math.min(fileSuggestions.length - 1, i + 1))
        return
      }
    }

    if (showingSlash && filteredSuggestions.length > 0) {
      if (key.tab || (key.return && filteredSuggestions.length > 0 && !wantsSoftBreak)) {
        const picked = filteredSuggestions[suggestionIdx]
        if (picked && key.tab) {
          const next = picked.completion
          applyTextEdit({ value: next, cursor: next.length })
          setPreferredColumn(null)
          return
        }
        if (picked && key.return && !wantsSoftBreak) {
          const next = picked.completion
          if (picked.executeOnEnter) {
            onSubmit(next)
            resetBuffer()
          } else {
            applyTextEdit({ value: next, cursor: next.length })
            setPreferredColumn(null)
          }
          return
        }
      }
      if (key.upArrow) {
        setSuggestionIdx(i => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setSuggestionIdx(i => Math.min(filteredSuggestions.length - 1, i + 1))
        return
      }
    }

    if (wantsSoftBreak) {
      insertText('\n')
      return
    }
    if (key.return) {
      submit()
      return
    }
    if (key.escape && mode === 'bash') {
      onModeChange?.('prompt')
      return
    }
    if (!value && inputText === '!' && mode === 'prompt' && onModeChange) {
      onModeChange('bash')
      return
    }
    if (key.ctrl && inputText === 'u') {
      applyTextEdit(deleteToLineStart(bufferRef.current, wrapWidth))
      setPreferredColumn(null)
      return
    }
    if (key.meta && inputText === 'v') {
      void (async () => {
        const image = await readClipboardImage()
        if (image.ok) insertText(`[image: ${image.path}]`)
      })()
      return
    }
    if (key.ctrl && inputText === 'a') {
      applyBuffer({ value: bufferRef.current.value, cursor: 0 })
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && inputText === 'e') {
      const currentBuffer = bufferRef.current
      applyBuffer({ value: currentBuffer.value, cursor: currentBuffer.value.length })
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && inputText === 'k') {
      const currentBuffer = bufferRef.current
      applyTextEdit({ value: currentBuffer.value.slice(0, currentBuffer.cursor), cursor: currentBuffer.cursor })
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && inputText === 'w') {
      const currentBuffer = bufferRef.current
      const left = currentBuffer.value.slice(0, currentBuffer.cursor)
      const right = currentBuffer.value.slice(currentBuffer.cursor)
      const newLeft = left.replace(/\S+\s*$/, '')
      applyTextEdit({ value: newLeft + right, cursor: newLeft.length })
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && inputText === 'p') {
      showPreviousHistory()
      return
    }
    if (key.ctrl && inputText === 'n') {
      showNextHistory()
      return
    }

    if (key.leftArrow) {
      const currentBuffer = bufferRef.current
      applyBuffer({ value: currentBuffer.value, cursor: Math.max(0, currentBuffer.cursor - 1) })
      setPreferredColumn(null)
      return
    }
    if (key.rightArrow) {
      const currentBuffer = bufferRef.current
      applyBuffer({
        value: currentBuffer.value,
        cursor: Math.min(currentBuffer.value.length, currentBuffer.cursor + 1),
      })
      setPreferredColumn(null)
      return
    }
    if (key.upArrow) {
      const currentBuffer = bufferRef.current
      const nextMove = moveVerticalVisual(
        currentBuffer.value,
        currentBuffer.cursor,
        -1,
        wrapWidth,
        preferredColumnRef.current,
      )
      preferredColumnRef.current = nextMove.preferredColumn
      setPreferredColumn(nextMove.preferredColumn)
      if (nextMove.kind === 'moved') {
        applyBuffer({ value: currentBuffer.value, cursor: nextMove.cursor })
        return
      }
      if (nextMove.kind === 'boundary-top') {
        if (historyPreviewActiveRef.current || historyIndexRef.current !== null || canNavigateHistory()) {
          showPreviousHistory(true)
        }
        return
      }
      return
    }
    if (key.downArrow) {
      const currentBuffer = bufferRef.current
      const nextMove = moveVerticalVisual(
        currentBuffer.value,
        currentBuffer.cursor,
        1,
        wrapWidth,
        preferredColumnRef.current,
      )
      preferredColumnRef.current = nextMove.preferredColumn
      setPreferredColumn(nextMove.preferredColumn)
      if (nextMove.kind === 'moved') {
        applyBuffer({ value: currentBuffer.value, cursor: nextMove.cursor })
        return
      }
      if (nextMove.kind === 'boundary-bottom') {
        if (historyPreviewActiveRef.current || historyIndexRef.current !== null) {
          showNextHistory(true)
        }
        return
      }
      return
    }
    if (key.backspace || key.delete) {
      const currentBuffer = bufferRef.current
      if (currentBuffer.cursor === 0) return
      applyTextEdit({
        value: currentBuffer.value.slice(0, currentBuffer.cursor - 1) + currentBuffer.value.slice(currentBuffer.cursor),
        cursor: Math.max(0, currentBuffer.cursor - 1),
      })
      return
    }
    if (key.tab || key.escape) return
    if (key.ctrl || key.meta) return

    if (inputText) {
      insertText(inputText)
      setPreferredColumn(null)
    }
  })

  const showPlaceholder = value.length === 0 && !disabled && placeholderHints && placeholderHints.length > 0
  const placeholder = showPlaceholder ? (placeholderHints[placeholderIdx] ?? placeholderHints[0] ?? '') : ''
  const promptColor = mode === 'bash' ? theme.accentWarm : (disabled ? theme.dim : theme.accentMint)
  const promptChar = mode === 'bash' ? '!' : prefix

  const display = useMemo(
    () => renderWithCursor(value, cursor, !disabled, wrapWidth, maxVisibleInputLines),
    [value, cursor, disabled, wrapWidth, maxVisibleInputLines],
  )
  const borderColor = disabled ? theme.border : theme.accentMint

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={2}
        width="100%"
        flexDirection="column"
      >
        {showPlaceholder ? (
          <Text>
            <Text color={promptColor}>{promptChar} </Text>
            <Text color={theme.dim}>{placeholder}</Text>
          </Text>
        ) : (
          <>
            {display.hiddenAbove > 0 ? (
              <Text color={theme.dim}>{`  ↑ ${display.hiddenAbove} earlier line${display.hiddenAbove === 1 ? '' : 's'}`}</Text>
            ) : null}
            <Box flexDirection="column" height={display.visibleLineCount} overflowY="hidden">
              {display.lines.map(line => (
                <Text key={line.visualLineIndex}>
                  {line.visualLineIndex === 0 ? (
                    <Text color={promptColor}>{promptChar} </Text>
                  ) : (
                    <Text color={theme.dim}>{'  '}</Text>
                  )}
                  {line.node}
                </Text>
              ))}
            </Box>
            {display.hiddenBelow > 0 ? (
              <Text color={theme.dim}>{`  ↓ ${display.hiddenBelow} later line${display.hiddenBelow === 1 ? '' : 's'}`}</Text>
            ) : null}
          </>
        )}
      </Box>
      {showingSlash && filteredSuggestions.length > 0 ? (
        <Box marginLeft={2} flexDirection="column">
          {filteredSuggestions.map((s, i) => (
            <Text key={s.name} color={i === suggestionIdx ? theme.accentPrimary : theme.dim}>
              {i === suggestionIdx ? '\u203a ' : '  '}/{s.name}
              <Text color={theme.dim}>  {s.summary}{i === suggestionIdx ? (s.executeOnEnter ? ' · enter runs' : ' · enter fills') : ''}</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      {showingFiles ? (
        <Box marginLeft={2} flexDirection="column">
          {fileSuggestions.slice(0, 8).map((s, i) => (
            <Text key={s.path} color={i === fileSuggestionIdx ? theme.accentPrimary : theme.dim}>
              {i === fileSuggestionIdx ? '\u203a ' : '  '}@{s.path}
              <Text color={theme.dim}>  {i === fileSuggestionIdx ? 'tab/enter completes' : s.hint}</Text>
            </Text>
          ))}
          {fileSuggestions.length > 8 ? (
            <Text color={theme.dim}>+{fileSuggestions.length - 8} more matches</Text>
          ) : null}
        </Box>
      ) : null}
      {queuedMessages.length > 0 ? (
        <Box marginLeft={2} flexDirection="column">
          <Text color={theme.dim}>
            {queuedMessages.length === 1 ? '1 message queued for next turn' : `${queuedMessages.length} messages queued for next turns`}
          </Text>
          {queuedMessages.slice(0, 3).map((message, i) => (
            <Text key={`${i}-${message.slice(0, 24)}`}>
              <Text color={theme.accentMint}>{i === 0 ? '» ' : '  '}</Text>
              <Text color={theme.textSubtle}>{summarizeQueuedMessage(message)}</Text>
            </Text>
          ))}
          {queuedMessages.length > 3 ? (
            <Text color={theme.dim}>+{queuedMessages.length - 3} more</Text>
          ) : null}
        </Box>
      ) : null}
      {footerRight ? (
        <Box marginLeft={2}>
          {footerRight}
        </Box>
      ) : null}
    </Box>
  )
}

function isSoftBreak(key: { return: boolean; meta?: boolean; shift?: boolean }): boolean {
  return key.return && Boolean(key.meta || key.shift)
}

type RenderedVisualLine = {
  visualLineIndex: number
  node: React.ReactNode
}

type RenderedInputViewport = {
  lines: RenderedVisualLine[]
  hiddenAbove: number
  hiddenBelow: number
  visibleLineCount: number
}

function renderWithCursor(
  value: string,
  cursor: number,
  showCursor: boolean,
  wrapWidth: number,
  maxVisibleLines: number,
): RenderedInputViewport {
  const lines = getVisualLines(value, wrapWidth)
  const cursorLine = getVisualLineIndex(lines, cursor)
  const window = getVisibleVisualLineWindow(lines.length, cursorLine, maxVisibleLines)
  const visibleLines = lines.slice(window.start, window.end)

  if (!showCursor) {
    return {
      lines: visibleLines.map((line, i) => ({
        visualLineIndex: window.start + i,
        node: (
          <Text color={theme.text} wrap="truncate">
            {value.slice(line.start, line.end) || ' '}
          </Text>
        ),
      })),
      hiddenAbove: window.start,
      hiddenBelow: lines.length - window.end,
      visibleLineCount: Math.max(1, visibleLines.length),
    }
  }

  return {
    lines: visibleLines.map((line, i) => {
      const visualLineIndex = window.start + i
      const text = value.slice(line.start, line.end)
      if (visualLineIndex !== cursorLine) {
        return {
          visualLineIndex,
          node: <Text color={theme.text} wrap="truncate">{text || ' '}</Text>,
        }
      }
      const column = Math.max(0, Math.min(cursor - line.start, text.length))
      const before = text.slice(0, column)
      const atChar = text[column] ?? ' '
      const after = text.slice(column + 1)
      return {
        visualLineIndex,
        node: (
          <Text color={theme.text} wrap="truncate">
            {before}
            <Text backgroundColor={theme.accentMint} color="#08110c">{atChar}</Text>
            {after}
          </Text>
        ),
      }
    }),
    hiddenAbove: window.start,
    hiddenBelow: lines.length - window.end,
    visibleLineCount: Math.max(1, visibleLines.length),
  }
}

function isFallbackPasteInput(input: string): boolean {
  if (!input) return false
  return input.length > LARGE_PASTE_THRESHOLD
    || countPastedTextLineBreaks(normalizePastedText(input)) > MAX_INLINE_PASTE_LINES
}

function summarizeQueuedMessage(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 69)}...`
}

type FileMentionSuggestion = {
  path: string
  hint: string
}

async function listFileMentionSuggestions(
  cwd: string,
  mention: FileMentionToken,
): Promise<FileMentionSuggestion[]> {
  const query = mention.query.replace(/\\/g, '/')
  const lastSlash = query.lastIndexOf('/')
  const queryDir = lastSlash >= 0 ? query.slice(0, lastSlash + 1) : ''
  const basenameQuery = lastSlash >= 0 ? query.slice(lastSlash + 1).toLowerCase() : query.toLowerCase()
  const baseDir = path.resolve(cwd, queryDir || '.')

  let entries: Array<{ name: string; isFile: () => boolean }>
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().startsWith(basenameQuery))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 32)
    .map(entry => {
      const relative = (queryDir + entry.name).replace(/\\/g, '/')
      return {
        path: relative,
        hint: path.extname(entry.name).slice(1) || 'file',
      }
    })
}
