import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { theme } from './theme.js'

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
  onSubmit: (value: T) => void
  onCancel?: () => void
}

export function Select<T>({ label, options, initialIndex = 0, onSubmit, onCancel }: SelectProps<T>) {
  const firstEnabled = Math.max(0, options.findIndex(o => !o.disabled))
  const start = options[initialIndex]?.disabled ? firstEnabled : initialIndex
  const [index, setIndex] = useState(start === -1 ? 0 : start)

  const moveBy = (delta: number) => {
    if (options.length === 0) return
    let next = index
    for (let i = 0; i < options.length; i++) {
      next = (next + delta + options.length) % options.length
      const candidate = options[next]
      if (candidate && !candidate.disabled) {
        setIndex(next)
        return
      }
    }
  }

  useInput((input, key) => {
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
      {options.map((option, i) => {
        const isActive = i === index
        const prefix = option.disabled ? '-' : isActive ? '>' : ' '
        const prefixColor = option.disabled ? theme.border : isActive ? theme.accentPrimary : theme.dim
        const labelColor = option.disabled ? theme.dim : isActive ? theme.accentPrimary : theme.text
        return (
          <Box key={i} flexDirection="row">
            <Text color={prefixColor}>{prefix} </Text>
            <Text color={labelColor} bold={isActive && !option.disabled}>{option.label}</Text>
            {option.hint ? <Text color={theme.dim}>  {option.hint}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}


