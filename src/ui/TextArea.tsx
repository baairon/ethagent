import React, { useState, useRef, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { theme, PANEL_WIDTH } from './theme.js'
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
  const [value, setValue] = useState(initialValue)
  const [cursor, setCursor] = useState(initialValue.length)
  const { stdout } = useStdout()
  const [columns, setColumns] = useState<number>(() => Math.floor(stdout?.columns ?? 80))

  useEffect(() => {
    if (!stdout) return
    const handleResize = () => setColumns(Math.floor(stdout.columns ?? 80))
    stdout.on('resize', handleResize)
    return () => { stdout.off('resize', handleResize) }
  }, [stdout])

  const stateRef = useRef({ value, cursor })
  stateRef.current = { value, cursor }

  useAppInput((input, key) => {
    const { value: val, cursor: cur } = stateRef.current

    if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
      return
    }
    if (key.ctrl && input === 's') {
      onSubmit(val)
      return
    }
    if (key.return) {
      const next = (val.slice(0, cur) + '\n' + val.slice(cur)).slice(0, maxLength)
      setValue(next)
      setCursor(cur + 1)
      return
    }
    if (key.backspace || key.delete) {
      if (cur === 0) return
      setValue(val.slice(0, cur - 1) + val.slice(cur))
      setCursor(cur - 1)
      return
    }
    if (key.leftArrow) {
      setCursor(Math.max(0, cur - 1))
      return
    }
    if (key.rightArrow) {
      setCursor(Math.min(val.length, cur + 1))
      return
    }
    if (key.upArrow) {
      setCursor(moveCursorUp(val, cur))
      return
    }
    if (key.downArrow) {
      setCursor(moveCursorDown(val, cur))
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
      const clean = input.replace(/\r/g, '')
      if (clean) {
        const next = (val.slice(0, cur) + clean + val.slice(cur)).slice(0, maxLength)
        setValue(next)
        setCursor(cur + clean.length)
      }
    }
  })

  const displayWidth = Math.min(PANEL_WIDTH - 6, Math.max(20, columns - 6))
  const [cursorLine, cursorCol] = cursorToLineCol(value, cursor)
  const lines = value.split('\n')
  const showPlaceholder = value.length === 0

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Box flexDirection="row">
          <Text color={theme.accentPeriwinkle}>{'> '}</Text>
          <Box width={displayWidth}>
            <Text>
              <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{' '}</Text>
              <Text color={theme.dim}>{placeholder ?? ''}</Text>
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {lines.map((line, i) => {
            const active = i === cursorLine
            return (
              <Box key={i} flexDirection="row">
                <Text color={theme.accentPeriwinkle}>{active ? '> ' : '  '}</Text>
                <Box width={displayWidth}>
                  {active ? (
                    <Text wrap="wrap">
                      <Text color={theme.text}>{line.slice(0, cursorCol)}</Text>
                      <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">
                        {line[cursorCol] ?? ' '}
                      </Text>
                      <Text color={theme.text}>{line.slice(cursorCol + 1)}</Text>
                    </Text>
                  ) : (
                    <Text color={theme.text} wrap="wrap">{line || ' '}</Text>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.dim}>ctrl+s save · ↵ newline · esc back</Text>
      </Box>
    </Box>
  )
}

function cursorToLineCol(val: string, cur: number): [number, number] {
  const lines = val.split('\n')
  let remaining = cur
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i]!.length
    if (remaining <= len) return [i, remaining]
    remaining -= len + 1
  }
  const last = lines.length - 1
  return [last, lines[last]!.length]
}

function moveCursorUp(val: string, cur: number): number {
  const lines = val.split('\n')
  const [lineIdx, colIdx] = cursorToLineCol(val, cur)
  if (lineIdx === 0) return cur
  const prevLine = lines[lineIdx - 1]!
  const newCol = Math.min(colIdx, prevLine.length)
  let pos = 0
  for (let i = 0; i < lineIdx - 1; i++) pos += lines[i]!.length + 1
  return pos + newCol
}

function moveCursorDown(val: string, cur: number): number {
  const lines = val.split('\n')
  const [lineIdx, colIdx] = cursorToLineCol(val, cur)
  if (lineIdx >= lines.length - 1) return cur
  const nextLine = lines[lineIdx + 1]!
  const newCol = Math.min(colIdx, nextLine.length)
  let pos = 0
  for (let i = 0; i <= lineIdx; i++) pos += lines[i]!.length + 1
  return pos + newCol
}
