import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { useContentWidth } from '../../../../ui/layout.js'
import { wrapWords } from '../../../../ui/text.js'

const LABEL_GAP = 2

type FieldRowProps = {
  label: string
  labelWidth: number
  value: React.ReactNode
  labelColor?: string
  valueColor?: string
}

export const FieldRow: React.FC<FieldRowProps> = ({ label, labelWidth, value, labelColor, valueColor }) => {
  const contentWidth = useContentWidth()
  const width = Math.max(labelWidth, label.length + LABEL_GAP)
  return (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <Text color={labelColor ?? theme.dim}>{label.padEnd(width)}</Text>
      </Box>
      <Box flexShrink={1}>
        {typeof value === 'string' || typeof value === 'number'
          ? <Text color={valueColor ?? theme.text}>{wrapWords(String(value), contentWidth - width).join('\n')}</Text>
          : value}
      </Box>
    </Box>
  )
}

export type Field = {
  label: string
  value: React.ReactNode
  valueColor?: string
}

type FieldListProps = {
  fields: Array<Field | null | false | undefined>
  labelColor?: string
}

export const FieldList: React.FC<FieldListProps> = ({ fields, labelColor }) => {
  const present = fields.filter((field): field is Field => Boolean(field))
  if (present.length === 0) return null
  const labelWidth = Math.max(...present.map(field => field.label.length)) + LABEL_GAP
  return (
    <Box flexDirection="column">
      {present.map(field => (
        <FieldRow
          key={field.label}
          label={field.label}
          labelWidth={labelWidth}
          value={field.value}
          {...(field.valueColor ? { valueColor: field.valueColor } : {})}
          {...(labelColor ? { labelColor } : {})}
        />
      ))}
    </Box>
  )
}
