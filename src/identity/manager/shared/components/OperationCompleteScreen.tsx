import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
import { theme } from '../../../../ui/theme.js'

type OperationCompleteScreenProps = {
  message: string
  onReturn: () => void
}

export const OperationCompleteScreen: React.FC<OperationCompleteScreenProps> = ({ message, onReturn }) => (
  <Surface title="Done">
    <Paragraph color={theme.text}>{message}</Paragraph>
    <Box marginTop={1}>
      <Select<'menu'>
        options={[{ value: 'menu', label: 'Back to Menu' }]}
        onSubmit={onReturn}
        onCancel={onReturn}
      />
    </Box>
  </Surface>
)
