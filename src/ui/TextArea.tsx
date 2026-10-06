import React, { useState, useRef } from 'react'
import { Box, Text } from 'ink'
import { theme } from './theme.js'
import { contentWidthFor, useTerminalColumns } from './layout.js'
import {
  charAt,
  cleanTypedText,
  layoutTextRows,
  moveAcrossRows,
  nextCharBoundary,
  prevCharBoundary,
  rowIndexAt,
  type TextRow,
} from './text.js'
import { useAppInput } from '../app/input/AppInputProvider.js'

type TextAreaProps = {
  initialValue?: string
  placeholder?: string
  maxLength?: number
  onSubmit: (value: string) => void
  onCancel?: () => void
}

export function TextArea({
  initialValue = '',
  placeholder,
  maxLength = 4096,
  onSubmit,
  onCancel,
}: TextAreaProps) {
  const [value, setValue] = useState(() => cleanTypedText(initialValue, true))
  const [cursor, setCursor] = useState(() => cleanTypedText(initialValue, true).length)
  const columns = useTerminalColumns()
  const displayWidth = textAreaWidth(columns)
  const rows = layoutTextRows(value, displayWidth - 1)

  const stateRef = useRef({ value, cursor, rows })
  stateRef.current = { value, cursor, rows }

  useAppInput((input, key) => {
    const { value: val, cursor: cur, rows: layout } = stateRef.current

    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
      return
    }
    if (key.return) {
      onSubmit(val)
      return
    }
    if (key.backspace || key.delete) {
      if (cur === 0) return
      const from = prevCharBoundary(val, cur)
      setValue(val.slice(0, from) + val.slice(cur))
      setCursor(from)
      return
    }
    if (key.leftArrow) {
      setCursor(prevCharBoundary(val, cur))
      return
    }
    if (key.rightArrow) {
      setCursor(nextCharBoundary(val, cur))
      return
    }
    if (key.upArrow) {
      setCursor(moveAcrossRows(layout, cur, -1))
      return
    }
    if (key.downArrow) {
      setCursor(moveAcrossRows(layout, cur, 1))
      return
    }
    if (key.ctrl && input === 'u') {
      const lineStart = Math.max(0, val.lastIndexOf('\n', cur - 1) + 1)
      setValue(val.slice(0, lineStart) + val.slice(cur))
      setCursor(lineStart)
      return
    }
    if (key.home || (key.ctrl && input === 'a')) {
      setCursor(Math.max(0, val.lastIndexOf('\n', cur - 1) + 1))
      return
    }
    if (key.end || (key.ctrl && input === 'e')) {
      const nextNewline = val.indexOf('\n', cur)
      setCursor(nextNewline === -1 ? val.length : nextNewline)
      return
    }
    if (key.ctrl || key.meta || key.tab) return
    if (input) {
      const clean = cleanTypedText(input, true)
      if (clean) {
        const next = (val.slice(0, cur) + clean + val.slice(cur)).slice(0, maxLength)
        setValue(next)
        setCursor(Math.min(next.length, cur + clean.length))
      }
    }
  })

  if (value.length === 0) {
    return (
      <Box flexDirection="row">
        <Text color={theme.accentPeriwinkle}>{'> '}</Text>
        <Box width={displayWidth}>
          <Text wrap="truncate-end">
            <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{' '}</Text>
            <Text color={theme.dim}>{placeholder ?? ''}</Text>
          </Text>
        </Box>
      </Box>
    )
  }

  const activeRow = rowIndexAt(rows, cursor)
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <Box key={`${row.start}:${index}`} flexDirection="row">
          <Text color={theme.accentPeriwinkle}>{index === activeRow ? '> ' : '  '}</Text>
          <Box width={displayWidth}>
            {index === activeRow
              ? <CursorRow value={value} row={row} cursor={cursor} width={displayWidth} />
              : <Text color={theme.text} wrap="truncate-end">{value.slice(row.start, row.end) || ' '}</Text>}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const CursorRow: React.FC<{ value: string; row: TextRow; cursor: number; width: number }> = ({ value, row, cursor, width }) => {
  const visible = value.slice(row.start, row.end)
  if (cursor < row.end) {
    const at = cursor - row.start
    const under = charAt(value, cursor)
    return (
      <Text wrap="truncate-end">
        <Text color={theme.text}>{visible.slice(0, at)}</Text>
        <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{under}</Text>
        <Text color={theme.text}>{visible.slice(at + under.length)}</Text>
      </Text>
    )
  }
  const gap = Math.max(0, Math.min(cursor - row.end, width - visible.length - 1))
  return (
    <Text wrap="truncate-end">
      <Text color={theme.text}>{visible}{' '.repeat(gap)}</Text>
      <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{' '}</Text>
    </Text>
  )
}

export function textAreaWidth(columns: number): number {
  return Math.min(contentWidthFor(columns) - 2, Math.max(20, columns - 6))
}
