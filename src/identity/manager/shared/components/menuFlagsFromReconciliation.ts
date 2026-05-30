import type { AgentReconciliation } from '../reconciliation/index.js'
import type { IdentityPerspective } from '../../custody/state.js'

type MenuFlags = {
  prepareTransferDisabled: boolean
  prepareTransferHint?: string
  prepareTransferHidden: boolean
  custodyModeDisabled: boolean
  custodyModeHint?: string
  ensNameDisabled: boolean
  ensNameHint?: string
  saveSnapshotDisabled: boolean
  refetchLatestDisabled: boolean
  refetchHint?: string
  tokenValuesUnlinkedNote?: string

  custodyAsterisk: boolean
  custodyHint?: string
  saveSnapshotAsterisk: boolean
  saveSnapshotHint?: string
  workingTreeDirty: boolean
}

export function menuFlagsFromReconciliation(r: AgentReconciliation, perspective: IdentityPerspective = 'unknown'): MenuFlags {
  const unlinked = r.token === 'unlinked'
  const inVault = r.custody === 'advanced' || r.custody === 'mid-flow-uri-pending'
  const isOperator = perspective === 'operator'

  let prepareTransferHint: string | undefined
  if (unlinked) {
    prepareTransferHint = 'Token unlinked'
  } else if (inVault) {
    prepareTransferHint = 'Token is in the Vault'
  }

  let custodyModeHint: string | undefined
  if (unlinked) {
    custodyModeHint = 'Token unlinked'
  }

  let ensNameHint: string | undefined
  if (unlinked) {
    ensNameHint = 'Token unlinked'
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

  const agentUriLocalNewer = r.agentUri === 'local-newer' && r.custody !== 'mid-flow-uri-pending'

  let saveSnapshotHint: string | undefined
  if (unlinked) {
    saveSnapshotHint = 'Token unlinked'
  } else if (agentUriLocalNewer) {
    saveSnapshotHint = 'Local newer than onchain'
  }

  const refetchHint: string | undefined = unlinked ? 'Token unlinked' : undefined

  return {
    prepareTransferDisabled: unlinked || inVault || isOperator,
    ...(prepareTransferHint ? { prepareTransferHint } : {}),
    prepareTransferHidden: inVault,
    custodyModeDisabled: unlinked || isOperator,
    ...(custodyModeHint ? { custodyModeHint } : {}),
    ensNameDisabled: unlinked || isOperator,
    ...(ensNameHint ? { ensNameHint } : {}),
    saveSnapshotDisabled: unlinked,
    refetchLatestDisabled: unlinked,
    ...(refetchHint ? { refetchHint } : {}),
    ...(unlinked ? { tokenValuesUnlinkedNote: 'Unlinked, retained for reference' } : {}),

    custodyAsterisk: custodyAsterisk && !isOperator,
    ...(custodyHint ? { custodyHint } : {}),
    saveSnapshotAsterisk: agentUriLocalNewer || r.workingTree === 'dirty',
    ...(saveSnapshotHint ? { saveSnapshotHint } : {}),
    workingTreeDirty: r.workingTree === 'dirty',
  }
}
