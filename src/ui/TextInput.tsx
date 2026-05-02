import React, { useState, useRef, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme } from './theme.js'
import { useAppInput } from '../app/input/AppInputProvider.js'
import { moveVerticalVisual } from '../chat/chatInputState.js'
import {
  getVisualLineIndex,
  getVisualLines,
} from '../chat/textCursor.js'

// ConversationStack padding=1 (2) + Surface border (2) + Surface paddingX=2 (4) + '> ' prefix (2) = 10
const DEFAULT_CHROME_WIDTH = 10

type TextInputProps = {
  label?: string
  placeholder?: string
  isSecret?: boolean
  initialValue?: string
  allowEmpty?: boolean
  multiline?: boolean
  chromeWidth?: number
  maxLength?: number
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel?: () => void
}

type RenderedTextInputLine = {
  visualLineIndex: number
  node: React.ReactNode
}

export function TextInput({
  label,
  placeholder,
  isSecret,
  initialValue = '',
  allowEmpty = false,
  multiline = false,
  chromeWidth = DEFAULT_CHROME_WIDTH,
  maxLength = 4096,
  validate,
  onSubmit,
  onCancel,
}: TextInputProps) {
  const { stdout } = useStdout()
  const [value, setValue] = useState(initialValue)
  const [cursor, setCursor] = useState(initialValue.length)
  const [preferredColumn, setPreferredColumn] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep a columns state updated via resize, matching ChatInput's pattern exactly
  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))
  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  const wrapWidth = textInputWrapWidth(columns, chromeWidth)

  // Sync refs during render so the input handler always reads fresh values,
  // even if AppInputProvider fires before the next useEffect cycle updates handlerRef.
  const stateRef = useRef({ value, cursor, preferredColumn, wrapWidth })
  stateRef.current = { value, cursor, preferredColumn, wrapWidth }

  useAppInput((input, key) => {
    const { value: val, cursor: cur, preferredColumn: prefCol, wrapWidth: ww } = stateRef.current

    if (key.return) {
      if (!allowEmpty && val.trim().length === 0) {
        setError('value cannot be empty')
        return
      }
      const validationError = validate?.(val) ?? null
      if (validationError) {
        setError(validationError)
        return
      }
      setError(null)
      onSubmit(val)
      return
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
      return
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, cur - 1))
      setPreferredColumn(null)
      return
    }
    if (key.rightArrow) {
      setCursor(Math.min(val.length, cur + 1))
      setPreferredColumn(null)
      return
    }
    if (multiline && (key.upArrow || key.downArrow)) {
      const result = moveVerticalVisual(val, cur, key.upArrow ? -1 : 1, ww, prefCol)
      if (result.kind === 'moved') setCursor(result.cursor)
      setPreferredColumn(result.preferredColumn)
      return
    }
    if (key.backspace || key.delete) {
      if (cur === 0) return
      setValue(val.slice(0, cur - 1) + val.slice(cur))
      setCursor(cur - 1)
      setPreferredColumn(null)
      if (error) setError(null)
      return
    }
    if (key.ctrl && input === 'u') {
      setValue('')
      setCursor(0)
      setPreferredColumn(null)
      if (error) setError(null)
      return
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
      return
    }
    if (input) {
      const clean = input.replace(/[\r\n]/g, '')
      if (clean) {
        const next = (val.slice(0, cur) + clean + val.slice(cur)).slice(0, maxLength)
        setValue(next)
        setCursor(Math.min(cur + clean.length, maxLength))
        setPreferredColumn(null)
        if (error) setError(null)
      }
    }
  })

  const display = isSecret ? '*'.repeat(value.length) : value
  const showPlaceholder = value.length === 0 && placeholder
  const renderedLines = multiline
    ? renderTextInputLines(display, cursor, true, wrapWidth)
    : []

  return (
    <Box flexDirection="column">
      {label ? <Text color={theme.dim}>{label}</Text> : null}
      {multiline && !showPlaceholder ? (
        <Box flexDirection="column">
          {renderedLines.map(line => (
            <Box key={line.visualLineIndex} flexDirection="row">
              <Text color={line.visualLineIndex === 0 ? theme.accentPrimary : theme.dim}>
                {line.visualLineIndex === 0 ? '> ' : '  '}
              </Text>
              <Box width={wrapWidth}>{line.node}</Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="row">
          <Text color={theme.accentPrimary}>{'> '}</Text>
          <Box width={wrapWidth}>
            {showPlaceholder ? (
              <Text wrap={multiline ? 'wrap' : 'truncate-end'}>
                <Text backgroundColor={theme.accentMint} color="#08110c">{' '}</Text>
                <Text color={theme.dim}>{placeholder}</Text>
              </Text>
            ) : (
              <Text color={theme.text} wrap="truncate-end">
                {display.slice(0, cursor)}
                <Text backgroundColor={theme.accentMint} color="#08110c">{display[cursor] ?? ' '}</Text>
                {display.slice(cursor + 1)}
              </Text>
            )}
          </Box>
        </Box>
      )}
      {error ? <Text color="#e87070">{error}</Text> : null}
    </Box>
  )
}

export function textInputWrapWidth(columns: number, chromeWidth = DEFAULT_CHROME_WIDTH): number {
  return Math.max(1, Math.floor(columns) - Math.max(0, Math.floor(chromeWidth)))
}

export function renderTextInputLines(
  value: string,
  cursor: number,
  showCursor: boolean,
  wrapWidth: number,
): RenderedTextInputLine[] {
  const lines = getVisualLines(value, wrapWidth)
  const cursorLine = getVisualLineIndex(lines, cursor)

  return lines.map((line, visualLineIndex) => {
    const text = value.slice(line.start, line.end)
    if (!showCursor || visualLineIndex !== cursorLine) {
      return {
        visualLineIndex,
        node: <Text color={theme.text} wrap="wrap">{text || ' '}</Text>,
      }
    }

    const column = Math.max(0, Math.min(cursor - line.start, text.length))
    const before = text.slice(0, column)
    const atChar = text[column] ?? ' '
    const after = text.slice(column + 1)
    return {
      visualLineIndex,
      node: (
        <Text color={theme.text} wrap="wrap">
          {before}
          <Text backgroundColor={theme.accentMint} color="#08110c">{atChar}</Text>
          {after}
        </Text>
      ),
    }
  })
}
