import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, gradientColor } from './theme.js'
import { useContentWidth } from './layout.js'
import { wrapWords } from './text.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

const SELECT_CHROME_ROWS = 17
const MIN_VISIBLE = 4
const CURSOR_WIDTH = 2
const HINT_GAP = 2

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

function isSectionOption<T>(option: SelectOption<T>): boolean {
  return option.role === 'section' || option.role === 'group'
}

function optionLabelText<T>(option: SelectOption<T>): string {
  return option.prefix && !isSectionOption(option) ? `${option.prefix} ${option.label}` : option.label
}

function inlineHintColumn<T>(options: Array<SelectOption<T>>, contentWidth: number): number {
  let column = 0
  for (const option of options) {
    if (!option.hint || isSectionOption(option)) continue
    const start = (option.indent ?? 0) + CURSOR_WIDTH + optionLabelText(option).length + HINT_GAP
    if (start + option.hint.length <= contentWidth) column = Math.max(column, start)
  }
  return column
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

  const contentWidth = useContentWidth()
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
  const hintColumn = hintLayout === 'inline' ? inlineHintColumn(options, contentWidth) : 0

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
        const indent = option.indent ?? 0
        const textWidth = Math.max(8, contentWidth - indent - CURSOR_WIDTH)

        if (isSectionOption(option)) {
          return (
            <Box key={absoluteIndex} flexDirection="column" marginLeft={indent}>
              <Text color={option.labelColor ?? theme.textSubtle} bold={option.bold ?? true}>{option.label || ' '}</Text>
              {option.hint ? <Text color={option.hintColor ?? theme.dim}>{wrapWords(option.hint, contentWidth - indent).join('\n')}</Text> : null}
            </Box>
          )
        }

        const isActive = absoluteIndex === index
        const selectable = isSelectableOption(option)
        const disabled = !!option.disabled
        const highlighted = isActive && selectable
        const cursor = highlighted ? '❯' : ' '
        const labelText = optionLabelText(option)
        const labelColor = highlighted
          ? theme.accentPeriwinkle
          : option.labelColor ?? (disabled ? theme.dim : theme.text)
        const hintColor = highlighted
          ? theme.textSubtle
          : disabled
            ? theme.border
            : option.hintColor ?? theme.dim
        const subtextColor = disabled ? theme.border : option.subtextColor ?? theme.dim
        const bold = option.bold ?? highlighted
        const hint = option.hint ?? ''
        const labelEnd = indent + CURSOR_WIDTH + labelText.length
        const inlineHint = Boolean(
          hint
          && hintLayout === 'inline'
          && hintColumn > 0
          && labelEnd + HINT_GAP <= hintColumn
          && hintColumn + hint.length <= contentWidth,
        )
        const belowHint = Boolean(hint) && !inlineHint
        const gap = inlineHint ? ' '.repeat(hintColumn - labelEnd) : ''
        return (
          <Box key={absoluteIndex} flexDirection="column" marginLeft={indent}>
            <Box flexDirection="row">
              <Text color={highlighted ? theme.accentPeriwinkle : theme.dim}>{cursor} </Text>
              <Box flexShrink={1}>
                {highlighted && labelText.length > 0 ? (
                  <Text>
                    {labelText.split('').map((ch, ci) => (
                      <Text key={ci} color={rainbowColor(ci, labelText.length)}>{ch}</Text>
                    ))}
                    {inlineHint ? <Text color={hintColor}>{gap}{hint}</Text> : null}
                  </Text>
                ) : (
                  <Text>
                    <Text color={labelColor} bold={bold}>{labelText}</Text>
                    {inlineHint ? <Text color={hintColor}>{gap}{hint}</Text> : null}
                  </Text>
                )}
              </Box>
            </Box>
            {option.subtext ? (
              <Box marginLeft={CURSOR_WIDTH}>
                <Text color={subtextColor}>{wrapWords(option.subtext, textWidth).join('\n')}</Text>
              </Box>
            ) : null}
            {belowHint ? (
              <Box marginLeft={CURSOR_WIDTH}>
                <Text color={hintColor}>{wrapWords(hint, textWidth).join('\n')}</Text>
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
