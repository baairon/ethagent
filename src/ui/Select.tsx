import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, PANEL_WIDTH, gradientColor } from './theme.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

const CONTENT_WIDTH = PANEL_WIDTH - 4
const SELECT_CHROME_ROWS = 17
const MIN_VISIBLE = 4

function fitHint(hint: string, budget: number): string {
  if (budget < 8) return ''
  if (hint.length <= budget) return hint
  return `${hint.slice(0, budget - 1)}…`
}

function rainbowColor(index: number, total: number): string {
  return gradientColor(total <= 1 ? 0 : index / (total - 1))
}

export type SelectOption<T> = {
  value: T
  label: string
  subtext?: string
  hint?: string
  disabled?: boolean
  role?: 'section' | 'group' | 'notice' | 'option' | 'utility'
  prefix?: string
  labelColor?: string
  subtextColor?: string
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
  const optionsSignature = useMemo(
    () => options.map(option => `${String(option.value)}:${option.disabled ? 'disabled' : 'enabled'}:${option.role ?? 'option'}`).join('|'),
    [options],
  )
  const firstEnabled = Math.max(0, options.findIndex(isSelectableOption))
  const start = isSelectableOption(options[initialIndex]) ? initialIndex : firstEnabled
  const [index, setIndex] = useState(start === -1 ? 0 : start)

  useEffect(() => {
    setIndex(start === -1 ? 0 : start)
  }, [optionsSignature, start])

  const { stdout } = useStdout()
  const [termRows, setTermRows] = useState<number | undefined>(stdout?.rows)
  useEffect(() => {
    if (!stdout) return
    const onResize = () => setTermRows(stdout.rows)
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])
  const autoVisible = termRows ? Math.max(MIN_VISIBLE, termRows - SELECT_CHROME_ROWS) : options.length
  const visibleCount = Math.max(1, maxVisible ?? autoVisible)
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
    } else if (key.escape || (key.ctrl && input === 'c')) {
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
        const selectable = isSelectableOption(option)
        const disabled = !!option.disabled
        const cursor = !selectable ? ' ' : isActive ? '❯' : ' '
        const isSection = option.role === 'section' || option.role === 'group'
        const prefix = option.prefix && !isSection ? `${option.prefix} ` : ''
        const rowIndent = option.indent ?? (usesInlineSections ? isSection ? 1 : 3 : 0)
        const prefixColor = disabled
          ? option.labelColor ?? theme.border
          : isActive && selectable
            ? theme.accentPeriwinkle
            : option.labelColor ?? theme.dim
        const labelColor = isSection
          ? option.labelColor ?? theme.textSubtle
          : isActive && selectable
            ? theme.accentPeriwinkle
            : option.labelColor ?? (disabled ? theme.dim : theme.text)
        const hintColor = isActive && selectable
          ? theme.textSubtle
          : disabled
            ? theme.border
            : option.hintColor ?? theme.dim
        const subtextColor = disabled ? theme.border : option.subtextColor ?? theme.dim
        const bold = option.bold ?? (isSection || (isActive && selectable))
        const inlineHint = Boolean(option.hint && hintLayout === 'inline' && !isSection)
        const belowHint = Boolean(option.hint && (!inlineHint || isSection))
        const inlineHintText = inlineHint
          ? fitHint(option.hint ?? '', CONTENT_WIDTH - rowIndent - prefix.length - option.label.length - 4)
          : ''
        const belowHintText = belowHint
          ? fitHint(option.hint ?? '', CONTENT_WIDTH - rowIndent - 2)
          : ''
        const showActiveGradient = isActive && selectable && !isSection && option.label.length > 0
        return (
          <Box key={absoluteIndex} flexDirection="column">
            <Box flexDirection="row" marginLeft={rowIndent}>
              <Text color={prefixColor}>{cursor} </Text>
              {prefix ? <Text color={prefixColor}>{prefix}</Text> : null}
              {showActiveGradient ? (
                <Text>
                  {option.label.split('').map((ch, ci) => (
                    <Text key={ci} color={rainbowColor(ci, option.label.length)}>{ch}</Text>
                  ))}
                </Text>
              ) : (
                <Text color={labelColor} bold={bold}>{option.label}</Text>
              )}
              {inlineHint && inlineHintText ? <Text color={hintColor}>  {inlineHintText}</Text> : null}
            </Box>
            {option.subtext ? (
              <Box marginLeft={2 + rowIndent}>
                <Text color={subtextColor}>{option.subtext}</Text>
              </Box>
            ) : null}
            {belowHint && belowHintText ? (
              <Box marginLeft={2 + rowIndent}>
                <Text color={hintColor}>{belowHintText}</Text>
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

function isSelectableOption<T>(option: SelectOption<T> | undefined): option is SelectOption<T> & { value: T } {
  if (!option || option.disabled) return false
  return option.role !== 'section' && option.role !== 'group' && option.role !== 'notice'
}
