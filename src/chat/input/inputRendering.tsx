import React from 'react'
import { Text } from 'ink'
import { theme } from '../../ui/theme.js'
import {
  getVisibleVisualLineWindow,
  getVisualLineIndex,
  getVisualLines,
} from './textCursor.js'

const STACK_HORIZONTAL_PADDING = 2
const INPUT_BORDER_WIDTH = 2
const INPUT_HORIZONTAL_PADDING = 4
const PROMPT_PREFIX_WIDTH = 2

type RenderedVisualLine = {
  visualLineIndex: number
  node: React.ReactNode
}

type RenderedInputViewport = {
  lines: RenderedVisualLine[]
  hiddenAbove: number
  hiddenBelow: number
  visibleLineCount: number
}

export function renderWithCursor(
  value: string,
  cursor: number,
  showCursor: boolean,
  wrapWidth: number,
  maxVisibleLines: number,
): RenderedInputViewport {
  const lines = getVisualLines(value, wrapWidth)
  const cursorLine = getVisualLineIndex(lines, cursor)
  const window = getVisibleVisualLineWindow(lines.length, cursorLine, maxVisibleLines)
  const visibleLines = lines.slice(window.start, window.end)

  if (!showCursor) {
    return {
      lines: visibleLines.map((line, i) => ({
        visualLineIndex: window.start + i,
        node: (
          <Text color={theme.text} wrap="wrap">
            {value.slice(line.start, line.end) || ' '}
          </Text>
        ),
      })),
      hiddenAbove: window.start,
      hiddenBelow: lines.length - window.end,
      visibleLineCount: Math.max(1, visibleLines.length),
    }
  }

  return {
    lines: visibleLines.map((line, i) => {
      const visualLineIndex = window.start + i
      const text = value.slice(line.start, line.end)
      if (visualLineIndex !== cursorLine) {
        return {
          visualLineIndex,
          node: <Text color={theme.text} wrap="wrap">{text || ' '}</Text>,
        }
      }
      const column = Math.max(0, Math.min(cursor - line.start, text.length))
      const before = text.slice(0, column)
      const atChar = text[column] ?? ' '
      const after = text.slice(column + 1)
      return {
        visualLineIndex,
        node: (
          <Text color={theme.text} wrap="wrap">
            {before}
            <Text backgroundColor={theme.accentPeriwinkle} color="#0c0c1f">{atChar}</Text>
            {after}
          </Text>
        ),
      }
    }),
    hiddenAbove: window.start,
    hiddenBelow: lines.length - window.end,
    visibleLineCount: Math.max(1, visibleLines.length),
  }
}

export function inputWrapWidth(columns: number): number {
  const fixedChromeWidth =
    STACK_HORIZONTAL_PADDING
    + INPUT_BORDER_WIDTH
    + INPUT_HORIZONTAL_PADDING
    + PROMPT_PREFIX_WIDTH
  return Math.max(1, Math.floor(columns) - fixedChromeWidth)
}
