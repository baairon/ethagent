import React from 'react'
import { Box, Text } from 'ink'
import { theme, gradientColor } from './theme.js'

type ProgressBarProps = {
  progress: number
  width?: number
  label?: string
  suffix?: string
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, width = 40, label, suffix }) => {
  const p = Math.max(0, Math.min(1, progress))
  const filled = Math.round(p * width)
  const empty = Math.max(0, width - filled)
  const cells: React.ReactElement[] = []
  for (let i = 0; i < filled; i++) {
    cells.push(
      <Text key={`f-${i}`} color={gradientColor(i / Math.max(width - 1, 1))}>█</Text>,
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

export default ProgressBar
