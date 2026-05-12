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
    prepareTransferReason = 'Operators cannot transfer the token.'
  } else if (!unlinked && (r.custody === 'advanced' || r.custody === 'mid-flow-uri-pending')) {
    prepareTransferReason = 'Token is in the vault. Withdraw it first in Custody Mode.'
  }

  const custodyAsterisk = r.custody === 'mid-flow-uri-pending' || r.vault === 'missing'
  let custodyHint: string | undefined
  if (isOperator) {
    custodyHint = undefined
  } else if (r.custody === 'mid-flow-uri-pending') {
    custodyHint = 'Advanced setup pending. Open to finish.'
  } else if (r.vault === 'missing') {
    custodyHint = 'Vault contract not found. Open to redeploy.'
  }

  const custodyModeReason = isOperator
    ? 'Operators cannot change custody, withdraw the token, or manage operators.'
    : undefined
  const ensNameReason = isOperator
    ? 'Operators cannot change the ENS subdomain or its records.'
    : undefined

  return {
    prepareTransferDisabled: unlinked || inVault || isOperator,
    ...(prepareTransferReason ? { prepareTransferReason } : {}),
    custodyModeDisabled: unlinked || isOperator,
    ...(custodyModeReason ? { custodyModeReason } : {}),
    ensNameDisabled: unlinked || isOperator,
    ...(ensNameReason ? { ensNameReason } : {}),
    saveSnapshotDisabled: unlinked,
    refetchLatestDisabled: unlinked,
    ...(unlinked ? { tokenValuesUnlinkedNote: 'Token no longer linked to this wallet, values retained for reference' } : {}),

    custodyAsterisk: custodyAsterisk && !isOperator,
    ...(custodyHint ? { custodyHint } : {}),
    saveSnapshotAsterisk: r.agentUri === 'local-newer',
    ...(r.agentUri === 'local-newer' ? { saveSnapshotHint: 'Local state newer than chain. Save to publish the latest agentURI.' } : {}),
  }
}
