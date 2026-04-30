import React from 'react'
import { render } from 'ink'
import { BrandSplash } from '../ui/BrandSplash.js'

/**
 * `ethagent preview` — renders the brand splash with only the tagline
 * in the top border, no technical details at the bottom, and exits.
 */
export async function runPreviewCommand(): Promise<number> {
  const instance = render(<BrandSplash />)
  // Give Ink one tick to paint, then unmount cleanly.
  await new Promise<void>(resolve => setTimeout(resolve, 50))
  instance.unmount()
  return 0
}
