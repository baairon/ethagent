import React from 'react'
import { Text } from 'ink'
import { theme } from '../../../../ui/theme.js'

type FlowTimelineProps = {
  steps: string[]
  current: number
}

export const FlowTimeline: React.FC<FlowTimelineProps> = ({ steps, current }) => {
  const position = Math.max(1, Math.min(steps.length, current))
  return (
    <Text>
      {steps.map((step, index) => {
        const n = index + 1
        const active = n === position
        const reached = n <= position
        return (
          <React.Fragment key={`${index}:${step}`}>
            {index > 0 ? <Text> </Text> : null}
            <Text color={active ? theme.accentPeriwinkle : reached ? theme.dim : theme.border} bold={active}>
              {reached ? '●' : '○'}
            </Text>
          </React.Fragment>
        )
      })}
      <Text color={theme.dim}>{`  ${position} of ${steps.length}`}</Text>
    </Text>
  )
}
