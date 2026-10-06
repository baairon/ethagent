import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../ui/theme.js'
import { FieldList } from '../shared/components/FieldRow.js'
import { changeLabel, type LocalChangeItem } from './state.js'

const MAX_ROWS = 8

export const ChangeList: React.FC<{ heading: string; items: LocalChangeItem[] }> = ({ heading, items }) => {
  const shown = items.slice(0, MAX_ROWS)
  const rest = items.length - shown.length
  return (
    <Box flexDirection="column">
      <Text color={theme.textSubtle}>{heading}</Text>
      <FieldList
        labelColor={theme.accentError}
        fields={shown.map(item => ({ label: item.name, value: changeLabel(item), valueColor: theme.dim }))}
      />
      {rest > 0 ? <Text color={theme.dim}>{`+${rest} more`}</Text> : null}
    </Box>
  )
}
