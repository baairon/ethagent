import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'

type OperationCompleteScreenProps = {
  message: string
  onReturn: () => void
}

export const OperationCompleteScreen: React.FC<OperationCompleteScreenProps> = ({ message, onReturn }) => (
  <Surface
    title="Done"
    footer={<Text color={theme.dim}>enter returns to menu</Text>}
  >
    <Box flexDirection="column">
      <Text color={theme.text}>{message}</Text>
      <Box marginTop={1}>
        <Select<'menu'>
          options={[{ value: 'menu', label: 'Return to Menu' }]}
          onSubmit={onReturn}
          onCancel={onReturn}
        />
      </Box>
    </Box>
  </Surface>
)
