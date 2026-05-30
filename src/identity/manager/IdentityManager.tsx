import React, { useEffect, useState } from 'react'
import { Box, useStdout } from 'ink'
import { IdentityManagerRoutes } from './Routes.js'
import type { IdentityManagerProps } from './types.js'
import { useIdentityManagerController } from './useController.js'
import { Wordmark } from './shared/components/Wordmark.js'

export type {
  IdentityManagerInitialAction,
  IdentityManagerResult,
} from './types.js'

export const IdentityManager: React.FC<IdentityManagerProps> = props => {
  const controller = useIdentityManagerController(props)
  const { stdout } = useStdout()
  const [rows, setRows] = useState<number>(stdout?.rows ?? 24)

  useEffect(() => {
    if (!stdout) return
    const onResize = () => setRows(stdout.rows ?? 24)
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" width="100%" minHeight={rows}>
      <Wordmark />
      <Box flexDirection="column" marginTop={1} width="100%">
        <IdentityManagerRoutes controller={controller} />
      </Box>
    </Box>
  )
}
