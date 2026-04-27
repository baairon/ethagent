import React from 'react'
import { Text } from 'ink'
import { theme } from './theme.js'

type StepIndicatorProps = {
  steps: string[]
  current: number // 1-indexed
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, current }) => {
  const parts: React.ReactNode[] = []
  for (let i = 0; i < steps.length; i++) {
    const stepNum = i + 1
    if (i > 0) {
      const lineColor = stepNum <= current ? theme.accentPrimary : theme.border
      parts.push(<Text key={`sep-${i}`} color={lineColor}> ─ </Text>)
    }
    if (stepNum < current) {
      parts.push(<Text key={`step-${i}`} color={theme.accentPrimary}>● {steps[i]}</Text>)
    } else if (stepNum === current) {
      parts.push(<Text key={`step-${i}`} color={theme.accentPrimary} bold>● {steps[i]}</Text>)
    } else {
      parts.push(<Text key={`step-${i}`} color={theme.dim}>○ {steps[i]}</Text>)
    }
  }
  return <Text>{parts}</Text>
}
