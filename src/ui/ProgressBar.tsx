import React from 'react'
import { Box, Text } from 'ink'
import { theme, gradientColor, eyeGradientColor } from './theme.js'

type ProgressBarProps = {
  progress: number
  width?: number
  label?: string
  suffix?: string
  variant?: 'default' | 'rainbow'
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, width = 40, label, suffix, variant = 'default' }) => {
  const p = Math.max(0, Math.min(1, progress))
  const filled = Math.round(p * width)
  const empty = Math.max(0, width - filled)
  const colorFor = variant === 'rainbow' ? eyeGradientColor : gradientColor
  const cells: React.ReactElement[] = []
  for (let i = 0; i < filled; i++) {
    cells.push(
      <Text key={`f-${i}`} color={colorFor(i / Math.max(width - 1, 1))}>█</Text>,
    )
  }
  for (let i = 0; i < empty; i++) {
    cells.push(<Text key={`e-${i}`} color={theme.border}>░</Text>)
  }
  return (
    <Box>
      {label ? <Text color={theme.dim}>{label} </Text> : null}
      <Text>{cells}</Text>
      <Text color={theme.dim}> {Math.round(p * 100)}%{suffix ? ` · ${suffix}` : ''}</Text>
    </Box>
  )
}
