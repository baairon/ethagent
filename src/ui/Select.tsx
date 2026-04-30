import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { useAppInput } from '../input/AppInputProvider.js'

export type SelectOption<T> = {
  value: T
  label: string
  hint?: string
  disabled?: boolean
  role?: 'section' | 'group' | 'notice' | 'option' | 'utility'
  prefix?: string
  labelColor?: string
  hintColor?: string
  bold?: boolean
  indent?: number
}

type SelectProps<T> = {
  label?: string
  options: Array<SelectOption<T>>
  initialIndex?: number
  maxVisible?: number
  hintLayout?: 'below' | 'inline'
  onSubmit: (value: T) => void
  onCancel?: () => void
  onHighlight?: (value: T) => void
}

export function Select<T>({
  label,
  options,
  initialIndex = 0,
  maxVisible,
  hintLayout = 'below',
  onSubmit,
  onCancel,
  onHighlight,
}: SelectProps<T>) {
  const firstEnabled = Math.max(0, options.findIndex(isSelectableOption))
  const start = isSelectableOption(options[initialIndex]) ? initialIndex : firstEnabled
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
  const usesInlineSections = hintLayout === 'inline' && options.some(option => option.role === 'section' || option.role === 'group')

  const moveBy = (delta: number) => {
    if (options.length === 0) return
    let next = index
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length
      const candidate = options[next]
      if (isSelectableOption(candidate)) {
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
      if (isSelectableOption(selected)) onSubmit(selected.value)
    } else if (key.escape) {
      onCancel?.()
    }
  })

  return (
    <Box flexDirection="column">
      {label ? <Text color={theme.dim}>{label}</Text> : null}
      {hasAbove ? (
        <Text color={theme.dim}>{`^ ${windowStart} earlier item${windowStart === 1 ? '' : 's'}`}</Text>
      ) : null}
      {visibleOptions.map((option, visibleIndex) => {
        const absoluteIndex = windowStart + visibleIndex
        const isActive = absoluteIndex === index
        const selectable = isSelectableOption(option)
        const cursor = !selectable ? ' ' : isActive ? '>' : ' '
        const isUtility = option.role === 'utility'
        const isSection = option.role === 'section' || option.role === 'group'
        const prefix = option.prefix && !isSection ? `${option.prefix} ` : ''
        const rowIndent = option.indent ?? (usesInlineSections ? isSection ? 1 : 3 : 0)
        const prefixColor = option.disabled
          ? option.labelColor ?? theme.border
          : isActive && selectable
            ? theme.accentPrimary
            : option.labelColor ?? theme.dim
        const labelColor = isSection
          ? option.labelColor ?? theme.dim
          : isActive && selectable
            ? isUtility ? theme.text : theme.accentPrimary
            : option.labelColor ?? (option.disabled ? theme.dim : isUtility ? theme.textSubtle : theme.text)
        const hintColor = isActive && selectable
          ? theme.textSubtle
          : option.hintColor ?? theme.dim
        const bold = option.bold ?? (isSection || (isActive && selectable && !isUtility))
        const inlineHint = Boolean(option.hint && hintLayout === 'inline' && !isSection)
        const belowHint = Boolean(option.hint && (!inlineHint || isSection))
        return (
          <Box key={absoluteIndex} flexDirection="column">
            <Box flexDirection="row" marginLeft={rowIndent}>
              <Text color={prefixColor}>{cursor} </Text>
              {prefix ? <Text color={prefixColor}>{prefix}</Text> : null}
              <Text color={labelColor} bold={bold}>{option.label}</Text>
              {inlineHint ? <Text color={hintColor}>  {option.hint}</Text> : null}
            </Box>
            {belowHint ? (
              <Box marginLeft={2 + rowIndent}>
                <Text color={hintColor}>{option.hint}</Text>
              </Box>
            ) : null}
          </Box>
        )
      })}
      {hasBelow ? (
        <Text color={theme.dim}>{`v ${options.length - windowEnd} more item${options.length - windowEnd === 1 ? '' : 's'}`}</Text>
      ) : null}
    </Box>
  )
}

function isSelectableOption<T>(option: SelectOption<T> | undefined): option is SelectOption<T> & { value: T } {
  if (!option || option.disabled) return false
  return option.role !== 'section' && option.role !== 'group' && option.role !== 'notice'
}
