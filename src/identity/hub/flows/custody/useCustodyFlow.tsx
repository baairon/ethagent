import type { CustodyFlow, CustodyFlowDeps } from './custodyFlowTypes.js'
import { createCustodyFlowActions } from './custodyFlowActions.js'
import { useCustodyTransactionEffects } from './custodyFlowEffects.js'
import {
  renderCustodyStep,
  renderRebackupSubtitle,
} from './custodyFlowRoutes.js'

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
} from './custodyFlowTypes.js'
