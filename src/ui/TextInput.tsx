import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

type TextInputProps = {
  label?: string
  placeholder?: string
  isSecret?: boolean
  initialValue?: string
  allowEmpty?: boolean
  maxLength?: number
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onCancel?: () => void
}

export function TextInput({
  label,
  placeholder,
  isSecret,
  initialValue = '',
  allowEmpty = false,
  maxLength = 4096,
  validate,
  onSubmit,
  onCancel,
}: TextInputProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  useAppInput((input, key) => {
    if (key.return) {
      if (!allowEmpty && value.trim().length === 0) {
        setError('value cannot be empty')
        return
      }
      const validationError = validate?.(value) ?? null
      if (validationError) {
        setError(validationError)
        return
      }
      setError(null)
      onSubmit(value)
      return
    }
    if (key.escape) {
      onCancel?.()
      return
    }
    if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
      if (error) setError(null)
      return
    }
    if (key.ctrl && input === 'u') {
      setValue('')
      if (error) setError(null)
      return
    }
    if (key.ctrl || key.meta || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.tab) {
      return
    }
    if (input) {
      const clean = input.replace(/[\r\n]/g, '')
      if (clean) {
        setValue(v => (v + clean).slice(0, maxLength))
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
        <Text color={theme.accentPrimary}>{'> '}</Text>
        {showPlaceholder ? (
          <>
            <Text color={theme.accentPrimary}>|</Text>
            <Text color={theme.dim}>{placeholder}</Text>
          </>
        ) : (
          <>
            <Text color={theme.text}>{display}</Text>
            <Text color={theme.accentPrimary}>|</Text>
          </>
        )}
      </Box>
      {error ? <Text color="#e87070">{error}</Text> : null}
    </Box>
  )
}

