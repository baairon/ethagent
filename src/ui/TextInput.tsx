import React, { useState, useRef, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme } from './theme.js'
import { useAppInput } from '../app/input/AppInputProvider.js'
import { moveVerticalVisual } from '../chat/chatInputState.js'
import {
  getVisualLineIndex,
  getVisualLines,
} from '../chat/textCursor.js'

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
  onNavigateLeft?: () => void
  onNavigateRight?: (value: string) => void
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
  onNavigateLeft,
  onNavigateRight,
}: TextInputProps) {
  const { stdout } = useStdout()
  const [value, setValue] = useState(initialValue)
  const [cursor, setCursor] = useState(initialValue.length)
  const [preferredColumn, setPreferredColumn] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))
  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  const wrapWidth = textInputWrapWidth(columns, chromeWidth)

  const stateRef = useRef({ value, cursor, preferredColumn, wrapWidth })
  stateRef.current = { value, cursor, preferredColumn, wrapWidth }

  useAppInput((input, key) => {
    const { value: val, cursor: cur, preferredColumn: prefCol, wrapWidth: ww } = stateRef.current

    const submitValue = (submit: (value: string) => void) => {
      if (!allowEmpty && val.trim().length === 0) {
        setError('value cannot be empty')
        return false
      }
      const validationError = validate?.(val) ?? null
      if (validationError) {
        setError(validationError)
        return false
      }
      setError(null)
      submit(val)
      return true
    }

    if (multiline && isTextInputSoftBreak(key)) {
      const next = insertTextInputText(val, cur, '\n', maxLength)
      setValue(next.value)
      setCursor(next.cursor)
      setPreferredColumn(null)
      if (error) setError(null)
      return
    }
    if (key.return) {
      submitValue(onSubmit)
      return
    }
    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
      return
    }
    if (key.leftArrow) {
      if (onNavigateLeft && cur === 0) {
        onNavigateLeft()
        return
      }
      setCursor(Math.max(0, cur - 1))
      setPreferredColumn(null)
      return
    }
    if (key.rightArrow) {
      if (onNavigateRight && cur === val.length) {
        submitValue(onNavigateRight)
        return
      }
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
      const lineStart = val.lastIndexOf('\n', cur - 1) + 1
      if (lineStart === cur) {
        if (!multiline || cur === 0) return
        setValue(val.slice(0, cur - 1) + val.slice(cur))
        setCursor(cur - 1)
      } else {
        setValue(val.slice(0, lineStart) + val.slice(cur))
        setCursor(lineStart)
      }
      setPreferredColumn(null)
      if (error) setError(null)
      return
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
      return
    }
    if (input) {
      const clean = multiline
        ? input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        : input.replace(/[\r\n]/g, '')
      if (clean) {
        const next = insertTextInputText(val, cur, clean, maxLength)
        setValue(next.value)
        setCursor(next.cursor)
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
              <Text color={line.visualLineIndex === 0 ? theme.accentPeriwinkle : theme.dim}>
                {line.visualLineIndex === 0 ? '> ' : '  '}
              </Text>
              <Box width={wrapWidth}>{line.node}</Box>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="row">
          <Text color={theme.accentPeriwinkle}>{'> '}</Text>
          <Box width={wrapWidth}>
            {showPlaceholder ? (
              <Text wrap={multiline ? 'wrap' : 'truncate-end'}>
                <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{' '}</Text>
                <Text color={theme.dim}>{placeholder}</Text>
              </Text>
            ) : (
              <Text color={theme.text} wrap="truncate-end">
                {display.slice(0, cursor)}
                <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{display[cursor] ?? ' '}</Text>
                {display.slice(cursor + 1)}
              </Text>
            )}
          </Box>
        </Box>
      )}
      {error ? <Text color={theme.accentError}>{error}</Text> : null}
    </Box>
  )
}

export function textInputWrapWidth(columns: number, chromeWidth = DEFAULT_CHROME_WIDTH): number {
  return Math.max(1, Math.floor(columns) - Math.max(0, Math.floor(chromeWidth)))
}

export function insertTextInputText(value: string, cursor: number, input: string, maxLength = 4096): { value: string; cursor: number } {
  const cleanCursor = Math.max(0, Math.min(cursor, value.length))
  const next = (value.slice(0, cleanCursor) + input + value.slice(cleanCursor)).slice(0, maxLength)
  return {
    value: next,
    cursor: Math.min(cleanCursor + input.length, next.length),
  }
}

export function isTextInputSoftBreak(key: { return: boolean; shift?: boolean; meta?: boolean }): boolean {
  return key.return && Boolean(key.shift || key.meta)
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
          <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{atChar}</Text>
          {after}
        </Text>
      ),
    }
  })
}
