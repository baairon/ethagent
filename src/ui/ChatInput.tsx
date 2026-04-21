import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from './theme.js'
import { readClipboardImage } from '../utils/clipboard.js'
import type { SlashSuggestion } from '../core/commands.js'
import {
  beginHistoryPreview,
  canNavigateHistory as canNavigateHistoryState,
  emptyBuffer,
  exitHistoryPreview,
  moveThroughHistory,
  moveVertical,
  type ChatBuffer,
} from './chatInputState.js'

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
}

const MAX_LENGTH = 32_768
const PASTE_THRESHOLD_LINES = 2
const PLACEHOLDER_ROTATE_MS = 8000

type PasteRef = { id: number; lines: string[] }

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
}) => {
  const [buffer, setBuffer] = useState<ChatBuffer>(emptyBuffer)
  const { value, cursor } = buffer
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draftBuffer, setDraftBuffer] = useState<ChatBuffer>(emptyBuffer)
  const [historyPreviewActive, setHistoryPreviewActive] = useState(false)
  const [preferredColumn, setPreferredColumn] = useState<number | null>(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [suggestionIdx, setSuggestionIdx] = useState(0)
  const pasteRefsRef = useRef<Map<number, PasteRef>>(new Map())
  const nextPasteIdRef = useRef(1)
  const bufferRef = useRef<ChatBuffer>(buffer)
  const historyIndexRef = useRef<number | null>(historyIndex)
  const draftBufferRef = useRef<ChatBuffer>(draftBuffer)
  const historyPreviewActiveRef = useRef(historyPreviewActive)
  const preferredColumnRef = useRef<number | null>(preferredColumn)

  useEffect(() => { bufferRef.current = buffer }, [buffer])
  useEffect(() => { historyIndexRef.current = historyIndex }, [historyIndex])
  useEffect(() => { draftBufferRef.current = draftBuffer }, [draftBuffer])
  useEffect(() => { historyPreviewActiveRef.current = historyPreviewActive }, [historyPreviewActive])
  useEffect(() => { preferredColumnRef.current = preferredColumn }, [preferredColumn])

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

  useEffect(() => {
    if (!placeholderHints || placeholderHints.length < 2) return
    const timer = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % placeholderHints.length)
    }, PLACEHOLDER_ROTATE_MS)
    return () => clearInterval(timer)
  }, [placeholderHints])

  const showingSlash = value.startsWith('/') && !value.includes(' ') && slashSuggestions.length > 0
  const filteredSuggestions = useMemo(() => {
    if (!showingSlash) return []
    const prefixValue = value.slice(1).toLowerCase()
    return slashSuggestions.filter(s => s.name.toLowerCase().startsWith(prefixValue)).slice(0, 6)
  }, [showingSlash, value, slashSuggestions])

  useEffect(() => {
    if (suggestionIdx >= filteredSuggestions.length) setSuggestionIdx(0)
  }, [filteredSuggestions.length, suggestionIdx])

  const insertText = useCallback((text: string) => {
    const prev = bufferRef.current
    const nextValue = (prev.value.slice(0, prev.cursor) + text + prev.value.slice(prev.cursor)).slice(0, MAX_LENGTH)
    const nextCursor = Math.min(prev.cursor + text.length, nextValue.length)
    applyBuffer({ value: nextValue, cursor: nextCursor })
    applyHistoryState(exitHistoryPreview({ value: nextValue, cursor: nextCursor }))
  }, [applyBuffer, applyHistoryState])

  const resetBuffer = useCallback(() => {
    applyBuffer(emptyBuffer())
    applyHistoryState({
      historyIndex: null,
      historyPreviewActive: false,
      draftBuffer: emptyBuffer(),
      preferredColumn: null,
    })
    pasteRefsRef.current.clear()
    nextPasteIdRef.current = 1
  }, [applyBuffer, applyHistoryState])

  const handlePaste = useCallback((text: string) => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n')
    if (lines.length <= PASTE_THRESHOLD_LINES) {
      insertText(normalized)
      return
    }
    const id = nextPasteIdRef.current++
    const preview = `[Pasted text #${id} +${lines.length - 1} lines]`
    pasteRefsRef.current.set(id, { id, lines })
    insertText(preview)
  }, [insertText])

  const expandPasteRefs = useCallback((text: string): string => {
    if (pasteRefsRef.current.size === 0) return text
    return text.replace(/\[Pasted text #(\d+) \+\d+ lines\]/g, (match, idStr) => {
      const id = Number(idStr)
      const ref = pasteRefsRef.current.get(id)
      return ref ? ref.lines.join('\n') : match
    })
  }, [])

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    const expanded = expandPasteRefs(trimmed)
    onSubmit(expanded)
    resetBuffer()
  }, [value, onSubmit, expandPasteRefs, resetBuffer])

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

  useInput((input, key) => {
    if (disabled) return

    const wantsSoftBreak = isSoftBreak(key)

    if (showingSlash && filteredSuggestions.length > 0) {
      if (key.tab || (key.return && filteredSuggestions.length > 0 && !wantsSoftBreak)) {
        const picked = filteredSuggestions[suggestionIdx]
        if (picked && key.tab) {
          const next = picked.completion
          setBuffer({ value: next, cursor: next.length })
          setPreferredColumn(null)
          return
        }
        if (picked && key.return && !wantsSoftBreak) {
          const next = picked.completion
          if (picked.executeOnEnter) {
            onSubmit(next)
            resetBuffer()
          } else {
            setBuffer({ value: next, cursor: next.length })
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
    if (!value && input === '!' && mode === 'prompt' && onModeChange) {
      onModeChange('bash')
      return
    }
    if (key.ctrl && input === 'u') {
      resetBuffer()
      return
    }
    if (key.meta && input === 'v') {
      void (async () => {
        const image = await readClipboardImage()
        if (image.ok) insertText(`[image: ${image.path}]`)
      })()
      return
    }
    if (key.ctrl && input === 'a') {
      setBuffer(prev => ({ value: prev.value, cursor: 0 }))
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && input === 'e') {
      setBuffer(prev => ({ value: prev.value, cursor: prev.value.length }))
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && input === 'k') {
      setBuffer(prev => ({ value: prev.value.slice(0, prev.cursor), cursor: prev.cursor }))
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && input === 'w') {
      setBuffer(prev => {
        const left = prev.value.slice(0, prev.cursor)
        const right = prev.value.slice(prev.cursor)
        const newLeft = left.replace(/\S+\s*$/, '')
        return { value: newLeft + right, cursor: newLeft.length }
      })
      setPreferredColumn(null)
      return
    }
    if (key.ctrl && input === 'p') {
      showPreviousHistory()
      return
    }
    if (key.ctrl && input === 'n') {
      showNextHistory()
      return
    }

    if (key.leftArrow) {
      const currentBuffer = bufferRef.current
      applyHistoryState(exitHistoryPreview(currentBuffer))
      applyBuffer({ value: currentBuffer.value, cursor: Math.max(0, currentBuffer.cursor - 1) })
      return
    }
    if (key.rightArrow) {
      const currentBuffer = bufferRef.current
      applyHistoryState(exitHistoryPreview(currentBuffer))
      applyBuffer({
        value: currentBuffer.value,
        cursor: Math.min(currentBuffer.value.length, currentBuffer.cursor + 1),
      })
      return
    }
    if (key.upArrow) {
      const currentBuffer = bufferRef.current
      if (currentBuffer.value.includes('\n')) {
        const nextMove = moveVertical(
          currentBuffer.value,
          currentBuffer.cursor,
          -1,
          preferredColumnRef.current,
        )
        preferredColumnRef.current = nextMove.preferredColumn
        setPreferredColumn(nextMove.preferredColumn)
        if (nextMove.kind === 'moved') {
          applyHistoryState(exitHistoryPreview(currentBuffer))
          applyBuffer({ value: currentBuffer.value, cursor: nextMove.cursor })
          return
        }
        if (nextMove.kind === 'boundary-top') {
          if (historyPreviewActiveRef.current || historyIndexRef.current !== null || canNavigateHistory()) {
            showPreviousHistory(true)
          }
          return
        }
      }
      showPreviousHistory()
      return
    }
    if (key.downArrow) {
      const currentBuffer = bufferRef.current
      if (currentBuffer.value.includes('\n')) {
        const nextMove = moveVertical(
          currentBuffer.value,
          currentBuffer.cursor,
          1,
          preferredColumnRef.current,
        )
        preferredColumnRef.current = nextMove.preferredColumn
        setPreferredColumn(nextMove.preferredColumn)
        if (nextMove.kind === 'moved') {
          applyHistoryState(exitHistoryPreview(currentBuffer))
          applyBuffer({ value: currentBuffer.value, cursor: nextMove.cursor })
          return
        }
        if (nextMove.kind === 'boundary-bottom') {
          if (historyPreviewActiveRef.current || historyIndexRef.current !== null) {
            showNextHistory(true)
          }
          return
        }
      }
      showNextHistory(historyIndex !== null || historyPreviewActive)
      return
    }
    if (key.backspace || key.delete) {
      const currentBuffer = bufferRef.current
      applyHistoryState(exitHistoryPreview(currentBuffer))
      if (currentBuffer.cursor === 0) return
      applyBuffer({
        value: currentBuffer.value.slice(0, currentBuffer.cursor - 1) + currentBuffer.value.slice(currentBuffer.cursor),
        cursor: Math.max(0, currentBuffer.cursor - 1),
      })
      return
    }
    if (key.tab || key.escape) return
    if (key.ctrl || key.meta) return

    if (input) {
      if (input.includes('\n') || input.length > 40) {
        handlePaste(input)
        return
      }
      insertText(input)
      setPreferredColumn(null)
    }
  })

  const showPlaceholder = value.length === 0 && !disabled && placeholderHints && placeholderHints.length > 0
  const placeholder = showPlaceholder ? (placeholderHints[placeholderIdx] ?? placeholderHints[0] ?? '') : ''
  const promptColor = mode === 'bash' ? theme.accentWarm : (disabled ? theme.dim : theme.accentMint)
  const promptChar = mode === 'bash' ? '!' : prefix

  const displayLines = useMemo(() => renderWithCursor(value, cursor, !disabled), [value, cursor, disabled])
  const borderColor = disabled ? theme.border : theme.accentMint
  const multiline = value.includes('\n')

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={2}
        width="100%"
        flexDirection={multiline ? 'column' : 'row'}
      >
        {showPlaceholder ? (
          <Text>
            <Text color={promptColor}>{promptChar} </Text>
            <Text color={theme.dim}>{placeholder}</Text>
          </Text>
        ) : multiline ? (
          displayLines.map((line, i) => (
            <Text key={i}>
              {i === 0 ? (
                <Text color={promptColor}>{promptChar} </Text>
              ) : (
                <Text color={theme.dim}>{'  '}</Text>
              )}
              {line}
            </Text>
          ))
        ) : (
          <Text>
            <Text color={promptColor}>{promptChar} </Text>
            {displayLines[0]}
          </Text>
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

function renderWithCursor(value: string, cursor: number, showCursor: boolean): React.ReactNode[] {
  const lines = value.length === 0 ? [''] : value.split('\n')
  if (!showCursor) {
    return lines.map((line, i) => <Text key={i} color={theme.text}>{line || ' '}</Text>)
  }
  let remaining = cursor
  return lines.map((line, i) => {
    if (remaining > line.length) {
      remaining -= line.length + 1
      return <Text key={i} color={theme.text}>{line || ' '}</Text>
    }
    if (remaining < 0) {
      return <Text key={i} color={theme.text}>{line || ' '}</Text>
    }
    const before = line.slice(0, remaining)
    const atChar = line[remaining] ?? ' '
    const after = line.slice(remaining + 1)
    remaining = -1
    return (
      <Text key={i}>
        <Text color={theme.text}>{before}</Text>
        <Text backgroundColor={theme.accentMint} color="#08110c">{atChar}</Text>
        <Text color={theme.text}>{after}</Text>
      </Text>
    )
  })
}

function summarizeQueuedMessage(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= 72) return normalized
  return `${normalized.slice(0, 69)}...`
}
