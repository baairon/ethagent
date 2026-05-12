import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'
import { identityPerspective, readCustodyMode } from '../../custody/state.js'
import { identityValuesCopyHint } from '../model/copy.js'
import { transferSnapshotView } from '../../transfer/state.js'
import { IdentitySummary } from './IdentitySummary.js'
import type { AgentReconciliation } from '../reconciliation/index.js'
import { menuFlagsFromReconciliation } from './menuFlagsFromReconciliation.js'

type MenuScreenProps = {
  mode: 'first-run' | 'manage'
  config?: EthagentConfig
  identity?: EthagentIdentity
  workingStatus?: ContinuityWorkingTreeStatus | null
  canRebackup: boolean
  reconciliation?: AgentReconciliation
  footer: React.ReactNode
  onCreate: () => void
  onLoad: () => void
  onBackupNow: () => void
  onRefetchLatest: () => void
  onPublicProfile: () => void
  onEnsName: () => void
  onWalletSetup: () => void
  onContinuity: () => void
  onIdentityValues: () => void
  onPrepareTransfer: () => void
  onStorage: () => void
  onSkip: () => void
  onCancel: () => void
}

type Action =
  | 'public-profile'
  | 'ens-name'
  | 'wallet-setup'
  | 'continuity'
  | 'backup'
  | 'refetch'
  | 'identity-values'
  | 'prepare-transfer'
  | 'storage'
  | 'create'
  | 'load'
  | 'skip'
  | 'cancel'

export const MenuScreen: React.FC<MenuScreenProps> = ({
  mode,
  config,
  identity,
  workingStatus,
  canRebackup,
  reconciliation,
  footer,
  onCreate,
  onLoad,
  onBackupNow,
  onRefetchLatest,
  onPublicProfile,
  onEnsName,
  onWalletSetup,
  onContinuity,
  onIdentityValues,
  onPrepareTransfer,
  onStorage,
  onSkip,
  onCancel,
}) => {
  const title = mode === 'first-run' ? 'Set Up Agent Identity' : 'Identity Hub'
  const subtitle = mode === 'first-run'
    ? 'Create a portable agent or load one you already own.'
    : 'Manage agent identity, custody, encrypted continuity, and recovery.'

  const canRefetch = Boolean(canRebackup && identity?.backup?.cid)
  const custodyMode = identity ? readCustodyMode(identity.state) : undefined

  const perspective = identityPerspective(identity)
  const flags = reconciliation
    ? menuFlagsFromReconciliation(reconciliation, perspective)
    : (perspective === 'operator'
      ? menuFlagsFromReconciliation({
          token: 'unknown', custody: 'unknown', agentUri: 'unknown',
          vault: 'unknown', workingTree: 'unknown', rpc: 'reachable', driftCount: 0, lastCheckedAt: '',
        }, perspective)
      : null)

  const walletSetupBaseHint = custodyMode === 'advanced'
    ? 'Advanced. Owner wallet, Vault, authorized operator wallets'
    : 'Simple. Switch to Advanced to delegate URI rotation through a dedicated Vault'

  const walletSetupLabel = flags?.custodyAsterisk ? 'Custody Mode *' : 'Custody Mode'
  const walletSetupHint = flags?.custodyModeReason ?? flags?.custodyHint ?? walletSetupBaseHint

  const saveSnapshotLabel = flags?.saveSnapshotAsterisk ? 'Save Snapshot Now *' : 'Save Snapshot Now'
  const saveSnapshotHint = flags?.saveSnapshotHint ?? 'Encrypt and publish latest snapshot'

  const ensNameHint = flags?.ensNameReason ?? 'Public name or subdomain for this agent'

  const prepareTransferHint = flags?.prepareTransferReason ?? 'Create transfer snapshot and handoff slots'

  const tokenValuesHint = flags?.tokenValuesUnlinkedNote ?? identityValuesCopyHint(identity)

  const options: Array<SelectOption<Action>> = identity
    ? [
        { value: 'public-profile', role: 'section', label: 'Public Identity' },
        { value: 'public-profile', label: 'Public Profile', hint: 'Name, description, icon, and Agent Card' },
        { value: 'ens-name', label: 'ENS Name', hint: ensNameHint, disabled: flags?.ensNameDisabled ?? false },
        { value: 'continuity', role: 'section', label: 'Continuity' },
        { value: 'continuity', label: 'Soul, Memory, Skills', hint: 'SOUL.md, MEMORY.md, skills.json on this device' },
        { value: 'backup', label: saveSnapshotLabel, hint: saveSnapshotHint, disabled: !canRebackup || (flags?.saveSnapshotDisabled ?? false) },
        { value: 'refetch', label: 'Refetch Latest', hint: 'Restore local files from latest saved snapshot', disabled: !canRefetch || (flags?.refetchLatestDisabled ?? false) },
        { value: 'wallet-setup', role: 'section', label: 'Custody' },
        { value: 'wallet-setup', label: walletSetupLabel, hint: walletSetupHint, disabled: !identity.agentId || (flags?.custodyModeDisabled ?? false) },
        { value: 'prepare-transfer', label: 'Prepare Transfer', hint: prepareTransferHint, disabled: flags?.prepareTransferDisabled ?? false },
        { value: 'identity-values', role: 'section', label: 'Token' },
        { value: 'identity-values', label: 'Token Values', hint: tokenValuesHint },
        { value: 'load', label: 'Load Agent', hint: 'Refresh this agent from chain, or load a different one' },
        { value: 'create', label: 'New Agent', hint: 'Mint another token and make it active' },
        { value: 'storage', role: 'section', label: 'Storage' },
        { value: 'storage', label: 'IPFS Storage', hint: 'Publishing credentials for encrypted snapshots' },
        { value: 'cancel', role: 'section', label: 'Exit' },
        { value: 'cancel', label: 'Close Identity Hub', hint: 'Return to chat without changing identity', role: 'utility' },
      ]
    : [
        { value: 'create', role: 'section', label: 'Setup' },
        { value: 'create', label: 'Create New Agent', hint: 'Mint a wallet-owned token for this machine' },
        { value: 'load', label: 'Load Existing Agent', hint: 'Find a token owned by this wallet or linked to it' },
        { value: mode === 'first-run' ? 'skip' : 'cancel', role: 'section', label: 'Exit' },
        ...(mode === 'first-run'
          ? [
              { value: 'skip' as Action, label: 'Skip For Now', hint: 'Continue now, use /identity later', role: 'utility' as const },
            ]
          : [
              { value: 'cancel' as Action, label: 'Close Identity Hub', hint: 'Return to chat without changing identity', role: 'utility' as const },
            ]),
      ]

  const reconciliationBanner = identity && reconciliation
    ? renderReconciliationBanner(reconciliation, identity)
    : null

  return (
    <Surface title={title} subtitle={subtitle} footer={footer}>
      <IdentitySummary
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        tokenLinked={reconciliation ? reconciliation.token === 'linked' : true}
        {...(reconciliation?.onChainOwner ? { onchainOwner: reconciliation.onChainOwner } : {})}
      />
      {reconciliationBanner ? (
        <Box marginTop={1} flexDirection="column">
          {reconciliationBanner}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Select<Action>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'skip') return onSkip()
            if (choice === 'cancel') return onCancel()
            if (choice === 'public-profile') return onPublicProfile()
            if (choice === 'ens-name') return onEnsName()
            if (choice === 'wallet-setup') return onWalletSetup()
            if (choice === 'continuity') return onContinuity()
            if (choice === 'backup') return onBackupNow()
            if (choice === 'refetch') return onRefetchLatest()
            if (choice === 'identity-values') return onIdentityValues()
            if (choice === 'prepare-transfer') return onPrepareTransfer()
            if (choice === 'storage') return onStorage()
            if (choice === 'load') return onLoad()
            if (choice === 'create') return onCreate()
          }}
          onCancel={mode === 'first-run' ? undefined : onCancel}
        />
      </Box>
    </Surface>
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
          <Text color={theme.textSubtle}>{tokenLabel} was transferred. Local SOUL.md, MEMORY.md, skills.json remain. Back them up before this directory is reused.</Text>
          <Text color={theme.textSubtle}>Use Load Agent or New Agent to re-enable disabled actions.</Text>
        </>
      )
    }
    return (
      <>
        <Text color={theme.accentError} bold>Agent Unlinked</Text>
        <Text color={theme.textSubtle}>{tokenLabel} left without Prepare Transfer. Back up local SOUL.md, MEMORY.md, skills.json before loading another agent.</Text>
        <Text color={theme.textSubtle}>For continuity handoff: ask the new holder to return the token, then run Prepare Transfer before re-sending.</Text>
        <Text color={theme.textSubtle}>Use Load Agent or New Agent to re-enable disabled actions.</Text>
      </>
    )
  }
  if (r.token === 'unknown') {
    return (
      <>
        <Text color={theme.dim}>Ownership Check Failed (RPC?)</Text>
        {r.tokenDetail ? <Text color={theme.dim}>{r.tokenDetail}</Text> : null}
      </>
    )
  }
  if (r.driftCount === 0) {
    return null
  }
  const lines: string[] = []
  if (r.custody === 'mid-flow-uri-pending') lines.push('Advanced setup pending. Open Custody Mode to finish.')
  if (r.agentUri === 'local-newer') lines.push('Local state newer than chain. Save Snapshot Now to publish.')
  if (r.agentUri === 'chain-newer') lines.push('Onchain agentURI is newer than local. Refetch Latest.')
  if (r.vault === 'missing') lines.push('Recorded vault address has no contract at it. Open Custody Mode to redeploy.')
  if (r.workingTree === 'dirty') lines.push('Local edits pending. Save Snapshot Now to publish.')
  return (
    <>
      <Text color={theme.accentPeriwinkle} bold>Agent Linked. {lines.length} item{lines.length === 1 ? '' : 's'} need attention</Text>
      {lines.map((line, i) => (
        <Text key={i} color={theme.textSubtle}>· {line}</Text>
      ))}
    </>
  )
}
