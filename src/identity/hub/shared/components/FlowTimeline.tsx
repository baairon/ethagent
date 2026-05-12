import React from 'react'
import { Text } from 'ink'
import { theme } from '../../../../ui/theme.js'

type FlowTimelineProps = {
  steps: string[]
  current: number
}

export const FlowTimeline: React.FC<FlowTimelineProps> = ({ steps, current }) => (
  <Text>
    {steps.map((step, index) => {
      const n = index + 1
      const active = n === current
      const done = n < current
      const glyph = done ? '✓' : active ? '●' : '○'
      return (
        <React.Fragment key={`${index}:${step}`}>
          {index > 0 ? <Text>  </Text> : null}
          <Text color={active ? theme.accentPeriwinkle : done ? theme.dim : theme.textSubtle} bold={active}>
            {glyph} {step}
          </Text>
        </React.Fragment>
      )
    })}
  </Text>
)
