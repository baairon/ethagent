import React, { useState, useRef, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, PANEL_WIDTH } from './theme.js'
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
}: TextInputProps) {
  const { stdout } = useStdout()
  const [value, setValue] = useState(initialValue)
  const [cursor, setCursor] = useState(initialValue.length)
  const [error, setError] = useState<string | null>(null)

  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))
  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  const wrapWidth = textInputWrapWidth(columns, chromeWidth, maxWidth)

  const stateRef = useRef({ value, cursor })
  stateRef.current = { value, cursor }

  useAppInput((input, key) => {
    const { value: val, cursor: cur } = stateRef.current

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
      return
    }
    if (key.rightArrow) {
      if (onNavigateRight && cur === val.length) {
        submitValue(onNavigateRight)
        return
      }
      setCursor(Math.min(val.length, cur + 1))
      return
    }
    if (key.backspace || key.delete) {
      if (cur === 0) return
      setValue(val.slice(0, cur - 1) + val.slice(cur))
      setCursor(cur - 1)
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
      const clean = input.replace(/[\r\n]/g, '')
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
              {display.slice(0, cursor)}
              <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{display[cursor] ?? ' '}</Text>
              {display.slice(cursor + 1)}
            </Text>
          )}
        </Box>
      </Box>
      {error ? <Text color={theme.accentError}>{error}</Text> : null}
    </Box>
  )
}

export function textInputWrapWidth(columns: number, chromeWidth = DEFAULT_CHROME_WIDTH, maxWidth = PANEL_WIDTH - 6): number {
  return Math.min(maxWidth, Math.max(1, Math.floor(columns) - Math.max(0, Math.floor(chromeWidth))))
}
