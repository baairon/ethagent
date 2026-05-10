import React from 'react'
import { IdentityHubRoutes } from './Routes.js'
import type { IdentityHubProps } from './types.js'
import { useIdentityHubController } from './useIdentityHubController.js'

export type {
  IdentityHubInitialAction,
  IdentityHubResult,
} from './types.js'

export const IdentityHub: React.FC<IdentityHubProps> = props => {
  const controller = useIdentityHubController(props)
  return <IdentityHubRoutes controller={controller} />
}
