import React from 'react'
import { Box } from 'ink'
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

  return (
    <Box flexDirection="column" alignItems="center" width="100%" marginTop={1}>
      <Wordmark />
      <Box flexDirection="column" marginTop={1} width="100%">
        <IdentityManagerRoutes controller={controller} />
      </Box>
    </Box>
  )
}
