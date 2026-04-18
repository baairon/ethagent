import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from './theme.js'
import { readClipboardImage } from '../utils/clipboard.js'

type Suggestion = { name: string; summary: string }

type PromptInputProps = {
  onSubmit: (value: string) => void
  history: string[]
  disabled?: boolean
  placeholderHints?: string[]
  prefix?: string
  slashSuggestions?: Suggestion[]
  mode?: 'prompt' | 'bash'
  onModeChange?: (mode: 'prompt' | 'bash') => void
  footerRight?: React.ReactNode
}

const MAX_LENGTH = 32_768
const PASTE_THRESHOLD_LINES = 2
const PLACEHOLDER_ROTATE_MS = 8000

type PasteRef = { id: number; lines: string[]; preview: string }

export const ChatInput: React.FC<PromptInputProps> = ({
  onSubmit,
  history,
  disabled,
  placeholderHints,
  prefix = '\u203a',
  slashSuggestions = [],
  mode = 'prompt',
  onModeChange,
  footerRight,
}) => {
  const [buffer, setBuffer] = useState<{ value: string; cursor: number }>({ value: '', cursor: 0 })
  const { value, cursor } = buffer
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [suggestionIdx, setSuggestionIdx] = useState(0)
  const pasteRefsRef = useRef<Map<number, PasteRef>>(new Map())
  const nextPasteIdRef = useRef(1)

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
    setBuffer(prev => {
      const next = (prev.value.slice(0, prev.cursor) + text + prev.value.slice(prev.cursor)).slice(0, MAX_LENGTH)
      const nextCursor = Math.min(prev.cursor + text.length, next.length)
      return { value: next, cursor: nextCursor }
    })
    setHistoryIndex(h => (h === null ? h : null))
  }, [])

  const resetBuffer = useCallback(() => {
    setBuffer({ value: '', cursor: 0 })
    setDraft('')
    setHistoryIndex(null)
    pasteRefsRef.current.clear()
    nextPasteIdRef.current = 1
  }, [])

  const handlePaste = useCallback((text: string) => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = normalized.split('\n')
    if (lines.length <= PASTE_THRESHOLD_LINES) {
      insertText(normalized)
      return
    }
    const id = nextPasteIdRef.current++
    const preview = `[Pasted text #${id} +${lines.length - 1} lines]`
    pasteRefsRef.current.set(id, { id, lines, preview })
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

  useInput((input, key) => {
    if (disabled) return

    if (showingSlash && filteredSuggestions.length > 0) {
      if (key.tab || (key.return && filteredSuggestions.length > 0 && !key.shift)) {
        const picked = filteredSuggestions[suggestionIdx]
        if (picked && key.tab) {
          const next = `/${picked.name} `
          setBuffer({ value: next, cursor: next.length })
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

    if (key.return && key.shift) {
      insertText('\n')
      return
    }
    if (key.return && !key.shift) {
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
    if (key.ctrl && input === 'j') {
      insertText('\n')
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
      return
    }
    if (key.ctrl && input === 'e') {
      setBuffer(prev => ({ value: prev.value, cursor: prev.value.length }))
      return
    }
    if (key.ctrl && input === 'k') {
      setBuffer(prev => ({ value: prev.value.slice(0, prev.cursor), cursor: prev.cursor }))
      return
    }
    if (key.ctrl && input === 'w') {
      setBuffer(prev => {
        const left = prev.value.slice(0, prev.cursor)
        const right = prev.value.slice(prev.cursor)
        const newLeft = left.replace(/\S+\s*$/, '')
        return { value: newLeft + right, cursor: newLeft.length }
      })
      return
    }

    if (key.leftArrow) {
      setBuffer(prev => ({ value: prev.value, cursor: Math.max(0, prev.cursor - 1) }))
      return
    }
    if (key.rightArrow) {
      setBuffer(prev => ({ value: prev.value, cursor: Math.min(prev.value.length, prev.cursor + 1) }))
      return
    }
    if (key.upArrow) {
      if (value.includes('\n')) {
        setBuffer(prev => ({ value: prev.value, cursor: moveVertical(prev.value, prev.cursor, -1) }))
        return
      }
      if (history.length === 0) return
      if (historyIndex === null) {
        setDraft(value)
        const lastIdx = history.length - 1
        setHistoryIndex(lastIdx)
        const chosen = history[lastIdx] ?? ''
        setBuffer({ value: chosen, cursor: chosen.length })
      } else if (historyIndex > 0) {
        const next = historyIndex - 1
        setHistoryIndex(next)
        const chosen = history[next] ?? ''
        setBuffer({ value: chosen, cursor: chosen.length })
      }
      return
    }
    if (key.downArrow) {
      if (value.includes('\n')) {
        setBuffer(prev => ({ value: prev.value, cursor: moveVertical(prev.value, prev.cursor, 1) }))
        return
      }
      if (historyIndex === null) return
      const next = historyIndex + 1
      if (next >= history.length) {
        setHistoryIndex(null)
        setBuffer({ value: draft, cursor: draft.length })
      } else {
        setHistoryIndex(next)
        const chosen = history[next] ?? ''
        setBuffer({ value: chosen, cursor: chosen.length })
      }
      return
    }
    if (key.backspace || key.delete) {
      setBuffer(prev => {
        if (prev.cursor === 0) return prev
        return {
          value: prev.value.slice(0, prev.cursor - 1) + prev.value.slice(prev.cursor),
          cursor: Math.max(0, prev.cursor - 1),
        }
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
              <Text color={theme.dim}>  {s.summary}</Text>
            </Text>
          ))}
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

function moveVertical(text: string, cursor: number, direction: 1 | -1): number {
  const before = text.slice(0, cursor)
  const lineStart = before.lastIndexOf('\n') + 1
  const col = cursor - lineStart
  if (direction === -1) {
    if (lineStart === 0) return cursor
    const prevLineEnd = lineStart - 1
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1
    const prevLineLen = prevLineEnd - prevLineStart
    return prevLineStart + Math.min(col, prevLineLen)
  }
  const nextNewline = text.indexOf('\n', cursor)
  if (nextNewline === -1) return cursor
  const nextLineStart = nextNewline + 1
  const nextNextNewline = text.indexOf('\n', nextLineStart)
  const nextLineEnd = nextNextNewline === -1 ? text.length : nextNextNewline
  const nextLineLen = nextLineEnd - nextLineStart
  return nextLineStart + Math.min(col, nextLineLen)
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

export default ChatInput
