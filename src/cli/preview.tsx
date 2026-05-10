import React from 'react'
import { Box, render } from 'ink'
import { BrandSplash } from '../ui/BrandSplash.js'

export async function runPreviewCommand(): Promise<number> {
  const instance = render(
    <Box flexDirection="column" marginY={1}>
      <BrandSplash />
    </Box>,
  )
  await new Promise<void>(resolve => setTimeout(resolve, 50))
  instance.unmount()
  return 0
}
