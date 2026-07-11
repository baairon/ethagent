import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'

type FieldRowProps = {
  label: string
  labelWidth: number
  value: React.ReactNode
  labelColor?: string
  valueColor?: string
}

export const FieldRow: React.FC<FieldRowProps> = ({ label, labelWidth, value, labelColor, valueColor }) => (
  <Box flexDirection="row">
    <Box flexShrink={0}>
      <Text color={labelColor ?? theme.dim}>{label.padEnd(labelWidth)}</Text>
    </Box>
    <Box flexShrink={1}>
      {typeof value === 'string' || typeof value === 'number'
        ? <Text color={valueColor ?? theme.text}>{value}</Text>
        : value}
    </Box>
  </Box>
)
