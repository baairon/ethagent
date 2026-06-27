import React from 'react'
import { Box, Text } from 'ink'
import { theme, PANEL_WIDTH } from '../../../../ui/theme.js'

type FlowTimelineProps = {
  steps: string[]
  current: number
}

export const FlowTimeline: React.FC<FlowTimelineProps> = ({ steps, current }) => (
  <Box width={PANEL_WIDTH - 4} justifyContent="center">
    <Text>
      {steps.map((step, index) => {
        const n = index + 1
        const active = n === current
        const reached = n <= current
        return (
          <React.Fragment key={`${index}:${step}`}>
            {index > 0 ? <Text> </Text> : null}
            <Text color={active ? theme.accentPeriwinkle : reached ? theme.dim : theme.textSubtle} bold={active}>
              {reached ? '●' : '○'}
            </Text>
          </React.Fragment>
        )
      })}
    </Text>
  </Box>
)
