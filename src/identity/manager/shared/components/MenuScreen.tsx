import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import { identityPerspective } from '../../custody/state.js'
import { transferSnapshotView } from '../../transfer/state.js'
import type { AgentReconciliation } from '../reconciliation/index.js'
import { menuFlagsFromReconciliation } from './menuFlagsFromReconciliation.js'
import { localChangeStatusView } from '../../continuity/state.js'
import { LazyMenu, type LazyMenuRow } from './LazyMenu.js'

import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'

type MenuScreenProps = {
  config?: EthagentConfig
  identity?: EthagentIdentity
  canRebackup: boolean
  reconciliation?: AgentReconciliation
  workingStatus?: ContinuityWorkingTreeStatus | null
  onCreate: () => void
  onLoad: () => void
  onBackupNow: () => void
  onRefetchLatest: () => void
  onPublicProfile: () => void
  onEnsName: () => void
  onWalletSetup: () => void
  onContinuity: () => void
  onSkillsTree: () => void
  onIdentityValues: () => void
  onPrepareTransfer: () => void
  onStorage: () => void
  onCancel: () => void
}

type Action =
  | 'public-profile'
  | 'ens-name'
  | 'wallet-setup'
  | 'continuity'
  | 'skills-tree'
  | 'backup'
  | 'refetch'
  | 'identity-values'
  | 'prepare-transfer'
  | 'storage'
  | 'create'
  | 'load'
  | 'cancel'

function shortAddress(addr: string | undefined): string {
  if (!addr) return ''
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function networkLabel(config?: EthagentConfig, identity?: EthagentIdentity): string | null {
  const chainId = identity?.chainId ?? config?.erc8004?.chainId
  if (chainId === 1) return 'mainnet'
  if (chainId === 8453) return 'base'
  return config?.selectedNetwork ?? null
}

export const MenuScreen: React.FC<MenuScreenProps> = ({
  config,
  identity,
  reconciliation,
  workingStatus,
  canRebackup,
  onCreate,
  onLoad,
  onBackupNow,
  onRefetchLatest,
  onPublicProfile,
  onEnsName,
  onWalletSetup,
  onContinuity,
  onSkillsTree,
  onIdentityValues,
  onPrepareTransfer,
  onStorage,
  onCancel,
}) => {
  const canRefetch = Boolean(canRebackup && identity?.backup?.cid)

  const perspective = identityPerspective(identity)
  const flags = reconciliation
    ? menuFlagsFromReconciliation(reconciliation, perspective)
    : (perspective === 'operator'
      ? menuFlagsFromReconciliation({
          token: 'unknown', custody: 'unknown', agentUri: 'unknown',
          vault: 'unknown', workingTree: 'unknown', rpc: 'reachable', driftCount: 0, lastCheckedAt: '',
        }, perspective)
      : null)

  const backupEnabled = canRebackup && !(flags?.saveSnapshotDisabled ?? false)
  const localChangeStatus = localChangeStatusView(workingStatus)

  const rows: Array<LazyMenuRow<Action>> = identity
    ? [
        { value: 'public-profile', label: 'Public Profile', shortcut: 'p' },
        { value: 'continuity',     label: 'Soul & Memory',  shortcut: 'm' },
        { value: 'skills-tree',    label: 'Skills',         shortcut: 's' },
        { value: 'backup',         label: 'Save Snapshot',  shortcut: 'a', disabled: !canRebackup || (flags?.saveSnapshotDisabled ?? false), hint: flags?.saveSnapshotHint, ...(localChangeStatus.hasLocalChanges && backupEnabled ? { inlineNote: localChangeStatus.files.length > 0 ? localChangeStatus.files.join(', ') : 'unsaved changes', inlineNoteColor: theme.accentError } : {}) },
        { value: 'refetch',        label: 'Refetch Latest', shortcut: 'r', disabled: !canRefetch || (flags?.refetchLatestDisabled ?? false), hint: flags?.refetchHint },
        { value: 'ens-name',       label: 'ENS Name',       shortcut: 'e', disabled: flags?.ensNameDisabled ?? false, hint: flags?.ensNameHint },
        { value: 'identity-values', label: 'Token Values',  shortcut: 'v', ...(flags?.tokenValuesUnlinkedNote ? { note: flags.tokenValuesUnlinkedNote } : {}) },
        { value: 'wallet-setup',   label: 'Custody Mode',   shortcut: 'c', disabled: !identity.agentId || (flags?.custodyModeDisabled ?? false), hint: flags?.custodyModeHint ?? flags?.custodyHint },
        ...(flags?.prepareTransferHidden ? [] : [{ value: 'prepare-transfer' as Action, label: 'Prepare Transfer', shortcut: 't', disabled: flags?.prepareTransferDisabled ?? false, hint: flags?.prepareTransferHint }]),
        { value: 'load',           label: 'Switch Agent',   shortcut: 'w' },
        { value: 'create',         label: 'New Agent',      shortcut: 'n' },
        { value: 'storage',        label: 'IPFS Storage',   shortcut: 'i' },
        { value: 'cancel',         label: 'Quit',           shortcut: 'q' },
      ]
    : [
        { value: 'create', label: 'Create New Agent' },
        { value: 'load',   label: 'Load Existing' },
      ]

  const reconciliationBanner = identity && reconciliation
    ? renderReconciliationBanner(reconciliation, identity)
    : null

  const network = networkLabel(config, identity)
  const statusBits: string[] = []
  if (identity?.agentId) statusBits.push(`#${identity.agentId}`)
  const displayAddress = perspective === 'operator' ? identity?.connectedWallet : identity?.ownerAddress
  if (displayAddress) statusBits.push(shortAddress(displayAddress))
  if (network) statusBits.push(network)
  if (perspective === 'operator') statusBits.push('operator')

  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Box flexDirection="column" alignItems="center">
        {reconciliationBanner ? (
          <Box marginBottom={1} flexDirection="column" alignItems="center">
            {reconciliationBanner}
          </Box>
        ) : null}
        {!identity ? (
          <Box marginBottom={1}>
            <Text color={theme.textSubtle}>Portable Ethereum identity for your AI agent.</Text>
          </Box>
        ) : null}
        <LazyMenu<Action>
          rows={rows}
          onSubmit={choice => {
            if (choice === 'cancel') return onCancel()
            if (choice === 'public-profile') return onPublicProfile()
            if (choice === 'ens-name') return onEnsName()
            if (choice === 'wallet-setup') return onWalletSetup()
            if (choice === 'continuity') return onContinuity()
            if (choice === 'skills-tree') return onSkillsTree()
            if (choice === 'backup') return onBackupNow()
            if (choice === 'refetch') return onRefetchLatest()
            if (choice === 'identity-values') return onIdentityValues()
            if (choice === 'prepare-transfer') return onPrepareTransfer()
            if (choice === 'storage') return onStorage()
            if (choice === 'load') return onLoad()
            if (choice === 'create') return onCreate()
          }}
          onCancel={onCancel}
        />
        {!identity ? (
          <Box marginTop={1}>
            <Text color={theme.dim}>↑↓ move · ↵ choose · esc quit</Text>
          </Box>
        ) : null}
      </Box>
      {statusBits.length > 0 ? (
        <Box marginTop={2}>
          <Text color={theme.menuStatus}>{statusBits.join(' · ')}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function renderReconciliationBanner(r: AgentReconciliation, identity: EthagentIdentity): React.ReactNode {
  if (r.token === 'no-agent') return null
  if (r.token === 'unlinked') {
    const tokenLabel = r.tokenAgentId ? `Token #${r.tokenAgentId}` : 'Token'
    const transferSnapshot = transferSnapshotView(identity)
    if (transferSnapshot) {
      return (
        <>
          <Text color={theme.accentError} bold>Agent Unlinked</Text>
          <Text color={theme.textSubtle}>{tokenLabel} was transferred. Local SOUL.md, MEMORY.md, and skills remain.</Text>
        </>
      )
    }
    return (
      <>
        <Text color={theme.accentError} bold>Agent Unlinked</Text>
        <Text color={theme.textSubtle}>{tokenLabel} left without Prepare Transfer.</Text>
      </>
    )
  }
  if (r.token === 'unknown') return null
  const lines: string[] = []
  if (r.custody === 'mid-flow-uri-pending') lines.push('Advanced setup pending')
  if (r.custody !== 'mid-flow-uri-pending' && r.agentUri === 'local-newer') lines.push('Local newer than onchain')
  if (r.custody !== 'mid-flow-uri-pending' && r.agentUri === 'chain-newer') lines.push('Onchain newer than local')
  if (r.vault === 'missing') lines.push('Vault contract missing')
  if (lines.length === 0) return null
  return (
    <>
      <Text color={theme.accentPeriwinkle} bold>{lines.length} item{lines.length === 1 ? '' : 's'} need attention</Text>
      {lines.map((line, i) => <Text key={i} color={theme.textSubtle}>· {line}</Text>)}
    </>
  )
}
