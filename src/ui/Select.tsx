import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { useAppInput } from '../input/AppInputProvider.js'

export type SelectOption<T> = {
  value: T
  label: string
  hint?: string
  disabled?: boolean
}

type SelectProps<T> = {
  label?: string
  options: Array<SelectOption<T>>
  initialIndex?: number
  maxVisible?: number
  onSubmit: (value: T) => void
  onCancel?: () => void
  onHighlight?: (value: T) => void
}

export function Select<T>({
  label,
  options,
  initialIndex = 0,
  maxVisible,
  onSubmit,
  onCancel,
  onHighlight,
}: SelectProps<T>) {
  const firstEnabled = Math.max(0, options.findIndex(option => !option.disabled))
  const start = options[initialIndex]?.disabled ? firstEnabled : initialIndex
  const [index, setIndex] = useState(start === -1 ? 0 : start)
  const visibleCount = Math.max(1, maxVisible ?? options.length)
  const windowStart = Math.max(0, Math.min(
    index - Math.floor(visibleCount / 2),
    Math.max(0, options.length - visibleCount),
  ))
  const windowEnd = Math.min(options.length, windowStart + visibleCount)
  const visibleOptions = options.slice(windowStart, windowEnd)
  const hasAbove = windowStart > 0
  const hasBelow = windowEnd < options.length

  const moveBy = (delta: number) => {
    if (options.length === 0) return
    let next = index
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length
      const candidate = options[next]
      if (candidate && !candidate.disabled) {
        setIndex(next)
        onHighlight?.(candidate.value)
        return
      }
    }
  }

  useAppInput((input, key) => {
    if (key.upArrow || input === 'k') moveBy(-1)
    else if (key.downArrow || input === 'j') moveBy(1)
    else if (key.return) {
      const selected = options[index]
      if (selected && !selected.disabled) onSubmit(selected.value)
    } else if (key.escape) {
      onCancel?.()
    }
  })

  return (
    <Box flexDirection="column">
      {label ? <Text color={theme.dim}>{label}</Text> : null}
      {hasAbove ? (
        <Text color={theme.dim}>{`↑ ${windowStart} earlier item${windowStart === 1 ? '' : 's'}`}</Text>
      ) : null}
      {visibleOptions.map((option, visibleIndex) => {
        const absoluteIndex = windowStart + visibleIndex
        const isActive = absoluteIndex === index
        const prefix = option.disabled ? ' ' : isActive ? '>' : ' '
        const prefixColor = option.disabled ? theme.border : isActive ? theme.accentPrimary : theme.dim
        const labelColor = option.disabled ? theme.dim : isActive ? theme.accentPrimary : theme.text
        return (
          <Box key={absoluteIndex} flexDirection="column">
            <Box flexDirection="row">
              <Text color={prefixColor}>{prefix} </Text>
              <Text color={labelColor} bold={isActive && !option.disabled}>{option.label}</Text>
            </Box>
            {option.hint ? (
              <Box marginLeft={2}>
                <Text color={isActive ? theme.textSubtle : theme.dim}>{option.hint}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
      {hasBelow ? (
        <Text color={theme.dim}>{`↓ ${options.length - windowEnd} more item${options.length - windowEnd === 1 ? '' : 's'}`}</Text>
      ) : null}
    </Box>
  )
}
