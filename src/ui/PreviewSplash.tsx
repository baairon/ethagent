import React from 'react'
import { Box, Text } from 'ink'
import { BrandSplash } from './BrandSplash.js'
import { theme } from './theme.js'

export const PreviewSplash: React.FC = () => (
  <Box flexDirection="column" alignSelf="flex-start" marginTop={4} marginBottom={4}>
    <BrandSplash />
    <Box paddingLeft={1} marginTop={2}>
      <Text bold color={theme.accentSecondary}>coming soon...</Text>
    </Box>
  </Box>
)
