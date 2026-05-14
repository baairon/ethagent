import type { AgentReconciliation } from '../reconciliation/index.js'
import type { IdentityPerspective } from '../../custody/state.js'

type MenuFlags = {
  prepareTransferDisabled: boolean
  prepareTransferReason?: string
  custodyModeDisabled: boolean
  custodyModeReason?: string
  ensNameDisabled: boolean
  ensNameReason?: string
  saveSnapshotDisabled: boolean
  refetchLatestDisabled: boolean
  tokenValuesUnlinkedNote?: string

  custodyAsterisk: boolean
  custodyHint?: string
  saveSnapshotAsterisk: boolean
  saveSnapshotHint?: string
}

export function menuFlagsFromReconciliation(r: AgentReconciliation, perspective: IdentityPerspective = 'unknown'): MenuFlags {
  const unlinked = r.token === 'unlinked'
  const inVault = r.custody === 'advanced' || r.custody === 'mid-flow-uri-pending'
  const isOperator = perspective === 'operator'

  let prepareTransferReason: string | undefined
  if (isOperator) {
    prepareTransferReason = 'Owner-only action'
  } else if (!unlinked && (r.custody === 'advanced' || r.custody === 'mid-flow-uri-pending')) {
    prepareTransferReason = 'Withdraw from vault first'
  }

  const custodyAsterisk = r.custody === 'mid-flow-uri-pending' || r.vault === 'missing'
  let custodyHint: string | undefined
  if (isOperator) {
    custodyHint = undefined
  } else if (r.custody === 'mid-flow-uri-pending') {
    custodyHint = 'Setup pending, open to finish'
  } else if (r.vault === 'missing') {
    custodyHint = 'Vault missing, open to redeploy'
  }

  const custodyModeReason = isOperator ? 'Owner-only action' : undefined
  const ensNameReason = isOperator ? 'Owner-only action' : undefined

  return {
    prepareTransferDisabled: unlinked || inVault || isOperator,
    ...(prepareTransferReason ? { prepareTransferReason } : {}),
    custodyModeDisabled: unlinked || isOperator,
    ...(custodyModeReason ? { custodyModeReason } : {}),
    ensNameDisabled: unlinked || isOperator,
    ...(ensNameReason ? { ensNameReason } : {}),
    saveSnapshotDisabled: unlinked,
    refetchLatestDisabled: unlinked,
    ...(unlinked ? { tokenValuesUnlinkedNote: 'Unlinked, retained for reference' } : {}),

    custodyAsterisk: custodyAsterisk && !isOperator,
    ...(custodyHint ? { custodyHint } : {}),
    saveSnapshotAsterisk: r.agentUri === 'local-newer',
    ...(r.agentUri === 'local-newer' ? { saveSnapshotHint: 'Local newer than chain' } : {}),
  }
}
