import React from 'react'
import { Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { useContentWidth } from '../../../../ui/layout.js'

type FlowTimelineProps = {
  steps: string[]
  current: number
}

const SEGMENT_GAP = 1

export const FlowTimeline: React.FC<FlowTimelineProps> = ({ steps, current }) => {
  const contentWidth = useContentWidth()
  const total = Math.max(1, steps.length)
  const position = Math.max(1, Math.min(total, current))
  const count = `${position} of ${total}`
  const widths = segmentWidths(total, contentWidth - count.length - 2)
  return (
    <Text>
      {widths.map((width, index) => {
        const n = index + 1
        const glyph = n <= position ? '━' : '─'
        const color = n === position ? theme.accentPeriwinkle : n < position ? theme.textSubtle : theme.border
        return (
          <React.Fragment key={`${index}:${steps[index] ?? ''}`}>
            {index > 0 ? <Text>{' '.repeat(SEGMENT_GAP)}</Text> : null}
            <Text color={color}>{glyph.repeat(width)}</Text>
          </React.Fragment>
        )
      })}
      <Text color={theme.dim}>{`  ${count}`}</Text>
    </Text>
  )
}

export function segmentWidths(total: number, trackWidth: number): number[] {
  const usable = Math.max(total, trackWidth - SEGMENT_GAP * (total - 1))
  const base = Math.floor(usable / total)
  const extra = usable - base * total
  return Array.from({ length: total }, (_, index) => base + (index < extra ? 1 : 0))
}
