import React from 'react'
import { Box, Text } from 'ink'
import { Splash } from './Splash.js'
import { theme } from './theme.js'

export const PreviewSplash: React.FC = () => (
  <Box flexDirection="column" alignSelf="flex-start" marginTop={4} marginBottom={4}>
    <Splash />
    <Box paddingLeft={1} marginTop={2}>
      <Text bold color={theme.accentSecondary}>coming soon...</Text>
    </Box>
  </Box>
)

export default PreviewSplash
