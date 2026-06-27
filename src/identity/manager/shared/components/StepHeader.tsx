import React from 'react'
import { Box, Text } from 'ink'
import { theme, PANEL_WIDTH } from '../../../../ui/theme.js'
import { FlowTimeline } from './FlowTimeline.js'

type StepHeaderProps = {
  steps: string[]
  current: number
  description?: React.ReactNode
}

export const StepHeader: React.FC<StepHeaderProps> = ({ steps, current, description }) => (
  <Box flexDirection="column" width={PANEL_WIDTH - 4}>
    <FlowTimeline steps={steps} current={current} />
    {description ? (
      <Box marginTop={1}>
        {typeof description === 'string'
          ? <Text color={theme.menuStatus}>{description}</Text>
          : description}
      </Box>
    ) : null}
  </Box>
)
