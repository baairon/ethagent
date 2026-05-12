import type { CustodyFlow, CustodyFlowDeps } from './types.js'
import { createCustodyFlowActions } from './actions.js'
import { useCustodyTransactionEffects } from './useCustodyEffects.js'
import {
  renderCustodyStep,
  renderRebackupSubtitle,
} from './routes.js'

export function useCustodyFlow(deps: CustodyFlowDeps): CustodyFlow {
  useCustodyTransactionEffects(deps)
  const actions = createCustodyFlowActions(deps)

  return {
    ...actions,
    renderCustodyStep: () => renderCustodyStep(deps),
    renderRebackupSubtitle,
  }
}

export type {
  CustodyFlow,
  CustodyFlowDeps,
  GuardOwnership,
  TriggerRebackup,
} from './types.js'
