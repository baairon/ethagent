import React, { useEffect, useState, useRef } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { contentWidthFor, useTerminalColumns } from './layout.js'
import { charAt, cleanTypedText, nextCharBoundary, prevCharBoundary, wrapWords } from './text.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

const DEFAULT_CHROME_WIDTH = 10

type TextInputProps = {
  label?: string
  placeholder?: string
  isSecret?: boolean
  initialValue?: string
  allowEmpty?: boolean
  chromeWidth?: number
  maxWidth?: number
  maxLength?: number
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel?: () => void
  onNavigateLeft?: () => void
  onNavigateRight?: (value: string) => void
  onChange?: (value: string) => void
}

export function TextInput({
  label,
  placeholder,
  isSecret,
  initialValue = '',
  allowEmpty = false,
  chromeWidth = DEFAULT_CHROME_WIDTH,
  maxWidth,
  maxLength = 4096,
  validate,
  onSubmit,
  onCancel,
  onNavigateLeft,
  onNavigateRight,
  onChange,
}: TextInputProps) {
  const [value, setValue] = useState(initialValue)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => { onChangeRef.current?.(value) }, [value])
  const [cursor, setCursor] = useState(initialValue.length)
  const [error, setError] = useState<string | null>(null)

  const columns = useTerminalColumns()

  const wrapWidth = textInputWrapWidth(columns, chromeWidth, maxWidth)

  const stateRef = useRef({ value, cursor })
  stateRef.current = { value, cursor }

  useAppInput((input, key) => {
    const { value: val, cursor: cur } = stateRef.current

    const submitValue = (submit: (value: string) => void) => {
      if (!allowEmpty && val.trim().length === 0) {
        setError('Enter a value.')
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
      setCursor(prevCharBoundary(val, cur))
      return
    }
    if (key.rightArrow) {
      if (onNavigateRight && cur === val.length) {
        submitValue(onNavigateRight)
        return
      }
      setCursor(nextCharBoundary(val, cur))
      return
    }
    if (key.backspace || key.delete) {
      if (cur === 0) return
      const from = prevCharBoundary(val, cur)
      setValue(val.slice(0, from) + val.slice(cur))
      setCursor(from)
      if (error) setError(null)
      return
    }
    if (key.ctrl && input === 'u') {
      setValue(val.slice(cur))
      setCursor(0)
      if (error) setError(null)
      return
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setCursor(0)
      return
    }
    if (key.end || (key.ctrl && input === 'e')) {
      setCursor(val.length)
      return
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) {
      return
    }
    if (input) {
      const clean = cleanTypedText(input, false)
      if (clean) {
        const cleanCursor = Math.max(0, Math.min(cur, val.length))
        const next = (val.slice(0, cleanCursor) + clean + val.slice(cleanCursor)).slice(0, maxLength)
        setValue(next)
        setCursor(Math.min(cleanCursor + clean.length, next.length))
        if (error) setError(null)
      }
    }
  })

  const display = isSecret ? '*'.repeat(value.length) : value
  const showPlaceholder = value.length === 0 && placeholder
  const view = inputViewport(display, Math.min(cursor, display.length), wrapWidth)

  return (
    <Box flexDirection="column">
      {label ? <Text color={theme.dim}>{label}</Text> : null}
      <Box flexDirection="row">
        <Text color={theme.accentPeriwinkle}>{'> '}</Text>
        <Box width={wrapWidth}>
          {showPlaceholder ? (
            <Text wrap="truncate-end">
              <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{' '}</Text>
              <Text color={theme.dim}>{placeholder}</Text>
            </Text>
          ) : (
            <Text color={theme.text} wrap="truncate-end">
              {view.before}
              <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{view.under}</Text>
              {view.after}
            </Text>
          )}
        </Box>
      </Box>
      {error ? <Text color={theme.accentError}>{wrapWords(error, contentWidthFor(columns)).join('\n')}</Text> : null}
    </Box>
  )
}

export function inputViewport(text: string, cursor: number, width: number): { before: string; under: string; after: string } {
  const room = Math.max(2, Math.floor(width))
  const under = charAt(text, cursor) || ' '
  const tail = text.slice(cursor + (cursor < text.length ? under.length : 0))
  if (text.length < room) return { before: text.slice(0, cursor), under, after: tail }
  let from = cursor > room - 2 ? cursor - (room - 2) : 0
  if (from > 0 && /[\udc00-\udfff]/.test(text.charAt(from))) from += 1
  const head = from > 0 ? `…${text.slice(from, cursor)}` : text.slice(0, cursor)
  const left = room - head.length - 1
  const after = tail.length <= left ? tail : left > 0 ? `${tail.slice(0, left - 1)}…` : ''
  return { before: head, under, after }
}

export function textInputWrapWidth(columns: number, chromeWidth = DEFAULT_CHROME_WIDTH, maxWidth = contentWidthFor(columns) - 2): number {
  return Math.min(maxWidth, Math.max(1, Math.floor(columns) - Math.max(0, Math.floor(chromeWidth))))
}
