import React from 'react'
import { Box } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
import { FlowTimeline } from './FlowTimeline.js'

type StepHeaderProps = {
  steps: string[]
  current: number
  description?: React.ReactNode
}

export const StepHeader: React.FC<StepHeaderProps> = ({ steps, current, description }) => (
  <Box flexDirection="column">
    <FlowTimeline steps={steps} current={current} />
    {description ? (
      <Box marginTop={1}>
        {typeof description === 'string'
          ? <Paragraph color={theme.menuStatus}>{description}</Paragraph>
          : description}
      </Box>
    ) : null}
  </Box>
)
