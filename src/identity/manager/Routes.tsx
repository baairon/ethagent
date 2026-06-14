import React from 'react'
import { Box, Text } from 'ink'
import { getAddress, isAddress } from 'viem'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentIdentity, SelectableNetwork } from '../../storage/config.js'
import { copyToClipboard } from '../../utils/clipboard.js'
import { DEFAULT_IPFS_API_URL } from '../storage/ipfs.js'
import { chainIdForNetwork, erc8004ConfigForSupportedChain, type Erc8004AgentCandidate } from '../registry/erc8004.js'
import { shortAddress } from './shared/model/format.js'
import { canRestoreCandidate } from './restore/discover.js'
import {
  resolveAgentEnsToCandidate,
  resolveAgentTokenIdToCandidate,
} from './restore/resolve.js'
import {
  runRegistrySubmit,
  runStorageSubmit,
} from './create/effects.js'
import {
  runRestoreRegistrySubmit,
} from './restore/restoreAdmin.js'
import { MenuScreen } from './shared/components/MenuScreen.js'
import { CreateFlow } from './create/CreateFlow.js'
import { RestoreFlow } from './restore/RestoreFlow.js'
import { NetworkScreen } from './shared/components/NetworkScreen.js'
import { DetailsScreen } from './shared/components/DetailsScreen.js'
import {
  TokenTransferFlow,
  isTokenTransferStep,
} from './transfer/TokenTransferFlow.js'
import {
  isCreateStep,
  isRestoreStep,
} from './shared/utils.js'
import { localChangeStatusView } from './continuity/state.js'
import { IdentityManagerOperationalRoutes } from './OperationalRoutes.js'
import type { IdentityManagerController } from './useController.js'
import type { Step } from './reducer.js'

export const IdentityManagerRoutes: React.FC<{ controller: IdentityManagerController }> = ({ controller }) => {
  const {
    config,
    onComplete,
    onConfigChange,
    identity,
    reconciliation,
    step,
    walletSession,
    restoreProgress,
    tokenTransferProgress,
    copyNotice,
    canRebackup,
    callbacks,
    workingStatus,
    setStep,
    back,
    closeManager,
    setCopyNotice,
    handleStepError,
    resolveRegistryForIdentity,
    finishFirstRunIdentity,
    openEnsEdit,
    openTokenTransferFlow,
  } = controller

  const footer = <Text color={theme.dim}>↵ select · esc back</Text>
  const setRestoreFetchingStep = (next: Extract<Step, { kind: 'restore-fetching' }>, backStep: Step): void => {
    if (
      isSameLoadedAgent(identity, next.candidate)
      && localChangeStatusView(workingStatus).hasLocalChanges
    ) {
      setStep({ kind: 'continuity-overwrite-confirm', action: 'restore', next, back: backStep })
      return
    }
    setStep(next)
  }

  if (step.kind === 'first-run-ens-prompt') {
    const tokenLabel = step.identity.agentId ? `#${step.identity.agentId}` : ''
    return (
      <Surface
        title={step.origin === 'restore' ? 'Agent Restored' : 'Token Minted'}
        subtitle={`${tokenLabel} is live. Optional: link an ENS name.`}
        footer={footer}
      >
        <Box flexDirection="column">
          <Text color={theme.textSubtle}>An ENS name like agent.you.eth gives your agent a public handle.</Text>
          <Text color={theme.textSubtle}>Optional. The token id and network already make it restorable.</Text>
        </Box>
        <Box marginTop={1}>
          <Select<'ens' | 'later'>
            options={[
              { value: 'ens', role: 'section', label: 'Set Up Now' },
              { value: 'ens', label: 'Set Up ENS Name', hint: 'Root → Name → Apply' },
              { value: 'later', role: 'section', label: 'Later' },
              { value: 'later', label: 'Add ENS Later', hint: 'Name it anytime from the menu', role: 'utility' },
            ]}
            hintLayout="below"
            onSubmit={choice => {
              if (choice === 'later') {
                finishFirstRunIdentity()
                return
              }
              setStep({
                kind: 'edit-profile-ens',
                identity: step.identity,
                registry: step.registry,
                returnTo: { kind: 'first-run-ens-prompt', identity: step.identity, registry: step.registry, origin: step.origin },
              })
            }}
            onCancel={finishFirstRunIdentity}
          />
        </Box>
      </Surface>
    )
  }

  if (step.kind === 'menu') {
    return (
      <MenuScreen
        config={config}
        identity={identity}
        canRebackup={canRebackup}
        reconciliation={reconciliation}
        workingStatus={workingStatus}
        onCreate={() => {
          if (identity) setStep({ kind: 'replace-confirm', next: 'create' })
          else setStep({ kind: 'create-name' })
        }}
        onLoad={() => {
          setCopyNotice(null)
          setStep({ kind: 'restore-wallet', purpose: identity ? 'switch' : 'restore' })
        }}
        onBackupNow={() => setStep({ kind: 'rebackup-confirm', back: { kind: 'menu' } })}
        onRefetchLatest={() => setStep({ kind: 'recovery-refetch-confirm', back: { kind: 'menu' } })}
        onPublicProfile={() => setStep({ kind: 'continuity-public' })}
        onEnsName={() => {
          if (!identity) return
          openEnsEdit({ kind: 'menu' })
        }}
        onWalletSetup={() => {
          if (!identity) return
          const reg = resolveRegistryForIdentity(identity)
          if (!reg) {
            handleStepError(new Error('no agent registry configured for this identity'), { kind: 'menu' })
            return
          }
          setStep({ kind: 'custody-model', identity, registry: reg, returnTo: { kind: 'menu' } })
        }}
        onContinuity={() => setStep({ kind: 'continuity-private' })}
        onSkillsTree={() => setStep({ kind: 'continuity-skills-tree' })}
        onIdentityValues={() => setStep({ kind: 'details' })}
        onPrepareTransfer={openTokenTransferFlow}
        onStorage={() => setStep({ kind: 'storage-credential' })}
        onCancel={closeManager}
      />
    )
  }

  if (isCreateStep(step)) {
    return (
      <CreateFlow
        step={step}
        walletSession={walletSession}
        onSetStep={setStep}
        onNameSubmit={name => setStep({ kind: 'create-description', name })}
        onDescriptionSubmit={(name, description) => setStep({ kind: 'create-network', name, description })}
        onCustodySubmit={(custodyMode) => {
          if (step.kind !== 'create-custody') return
          setStep({ kind: 'create-import', name: step.name, description: step.description, ...(step.network ? { network: step.network } : {}), custodyMode })
        }}
        onRegistrySubmit={async value => {
          if (step.kind !== 'create-registry') return
          try {
            await runRegistrySubmit(value, step, config, onConfigChange, callbacks)
          } catch (err: unknown) {
            setStep({ kind: 'create-registry', name: step.name, description: step.description, resolution: step.resolution, custodyMode: step.custodyMode, error: (err as Error).message })
          }
        }}
        onStorageSubmit={async input => {
          if (step.kind !== 'create-storage') return
          try {
            await runStorageSubmit(input, step, callbacks)
          } catch (err: unknown) {
            setStep({
              kind: 'create-storage',
              name: step.name,
              description: step.description,
              registry: step.registry,
              custodyMode: step.custodyMode,
              error: (err as Error).message,
              pinataJwt: step.pinataJwt,
            })
          }
        }}
        onBack={back}
        onMenu={() => setStep({ kind: 'menu' })}
      />
    )
  }

  if (step.kind === 'create-network') {
    return (
      <NetworkScreen
        subtitle="Choose where to create this agent."
        footer={footer}
        onSelect={(network: SelectableNetwork) => {
          setStep({ kind: 'create-custody', name: step.name, description: step.description, network })
        }}
        onCancel={back}
      />
    )
  }

  if (step.kind === 'restore-network') {
    return (
      <NetworkScreen
        subtitle="Choose a network to search for your agents."
        footer={footer}
        onSelect={(network: SelectableNetwork) => {
          try {
            const registry = erc8004ConfigForSupportedChain(chainIdForNetwork(network))
            setStep({ kind: 'restore-discovering', ownerHandle: step.ownerHandle, registry, purpose: step.purpose })
          } catch (err: unknown) {
            handleStepError(err, { kind: 'restore-network', ownerHandle: step.ownerHandle, purpose: step.purpose })
          }
        }}
        onCancel={back}
      />
    )
  }

  if (isRestoreStep(step)) {
    return (
      <RestoreFlow
        step={step}
        config={config}
        walletSession={walletSession}
        restoreProgress={restoreProgress}
        onRestoreRegistrySubmit={async value => {
          if (step.kind !== 'restore-registry') return
          try {
            await runRestoreRegistrySubmit(value, step, config, onConfigChange, callbacks)
          } catch (err: unknown) {
            setStep({ kind: 'restore-registry', ownerHandle: step.ownerHandle, error: (err as Error).message, purpose: step.purpose })
          }
        }}
        onRetryDiscovery={() => {
          if (step.kind !== 'restore-not-found') return
          setStep({
            kind: 'restore-discovering',
            ownerHandle: step.ownerHandle,
            registry: step.registry,
            purpose: step.purpose,
          })
        }}
        onTokenSelect={value => {
          if (step.kind !== 'restore-select-token') return
          const candidate = step.candidates.find(item => item.agentId.toString() === value)
          if (!candidate?.backup?.cid) return
          setRestoreFetchingStep({
            kind: 'restore-fetching',
            cid: candidate.backup.cid,
            apiUrl: DEFAULT_IPFS_API_URL,
            candidate,
            requesterAddress: step.requesterAddress,
            purpose: step.purpose,
          }, step)
        }}
        onEnsSubmit={async value => {
          if (step.kind !== 'restore-ens-input') return
          setStep({ ...step, busy: true, error: undefined })
          const resolution = await resolveAgentEnsToCandidate(value, step.registry)
          if (!resolution.ok) {
            setStep({ ...step, busy: false, error: resolution.message })
            return
          }
          if (!resolution.candidate.backup?.cid) {
            setStep({ ...step, busy: false, error: 'This token has no encrypted snapshot. Save the agent first from the owner wallet.' })
            return
          }
          if (!isAddress(step.ownerHandle, { strict: false }) || !canRestoreCandidate(resolution.candidate, getAddress(step.ownerHandle))) {
            setStep({ ...step, busy: false, error: `${shortAddress(step.ownerHandle)} is not an operator wallet for this agent. Sign in with an approved operator wallet, or with the owner wallet that holds the token.` })
            return
          }
          setRestoreFetchingStep({
            kind: 'restore-fetching',
            cid: resolution.candidate.backup.cid,
            apiUrl: DEFAULT_IPFS_API_URL,
            candidate: resolution.candidate,
            requesterAddress: step.ownerHandle,
            purpose: step.purpose,
          }, { ...step, busy: false, error: undefined })
        }}
        onTokenIdSubmit={async value => {
          if (step.kind !== 'restore-token-id-input') return
          setStep({ ...step, busy: true, error: undefined })
          const resolution = await resolveAgentTokenIdToCandidate(value, step.registry)
          if (!resolution.ok) {
            setStep({ ...step, busy: false, error: resolution.message })
            return
          }
          if (!resolution.candidate.backup?.cid) {
            setStep({ ...step, busy: false, error: 'This token has no encrypted snapshot. Save the agent first from the owner wallet.' })
            return
          }
          if (!isAddress(step.ownerHandle, { strict: false }) || !canRestoreCandidate(resolution.candidate, getAddress(step.ownerHandle))) {
            setStep({ ...step, busy: false, error: `${shortAddress(step.ownerHandle)} is not an operator wallet for this agent. Sign in with an approved operator wallet, or with the owner wallet that holds the token.` })
            return
          }
          setRestoreFetchingStep({
            kind: 'restore-fetching',
            cid: resolution.candidate.backup.cid,
            apiUrl: DEFAULT_IPFS_API_URL,
            candidate: resolution.candidate,
            requesterAddress: step.ownerHandle,
            purpose: step.purpose,
          }, { ...step, busy: false, error: undefined })
        }}
        onPickRecoveryMethod={choice => {
          if (step.kind !== 'restore-recovery-input' && step.kind !== 'restore-select-token') return
          if (choice === 'ens') {
            setStep({ kind: 'restore-ens-input', ownerHandle: step.ownerHandle, registry: step.registry, purpose: step.purpose })
          } else {
            setStep({ kind: 'restore-token-id-input', ownerHandle: step.ownerHandle, registry: step.registry, purpose: step.purpose })
          }
        }}
        onBack={back}
      />
    )
  }

  if (step.kind === 'details') {
    return (
      <DetailsScreen
        identity={identity}
        config={config}
        workingStatus={workingStatus}
        copyNotice={copyNotice}
        unlinked={reconciliation?.token === 'unlinked'}
        {...(reconciliation?.onChainOwner ? { onchainOwner: reconciliation.onChainOwner } : {})}
        footer={footer}
        onCopy={async (label, value) => {
          const result = await copyToClipboard(value)
          setCopyNotice(result.ok ? `${label} copied to clipboard.` : `copy failed: ${result.error}`)
          setStep({ kind: 'details' })
        }}
        onBack={back}
      />
    )
  }

  if (isTokenTransferStep(step)) {
    return (
      <TokenTransferFlow
        step={step}
        callbacks={callbacks}
        footer={footer}
        progress={tokenTransferProgress}
        walletSession={walletSession}
        onSetStep={setStep}
        onBack={back}
      />
    )
  }

  return <IdentityManagerOperationalRoutes controller={controller} footer={footer} />
}

function isSameLoadedAgent(identity: EthagentIdentity | undefined, candidate: Erc8004AgentCandidate): boolean {
  if (!identity?.agentId || !identity.chainId || !identity.identityRegistryAddress) return false
  if (identity.chainId !== candidate.chainId) return false
  if (identity.agentId !== candidate.agentId.toString()) return false
  return identity.identityRegistryAddress.toLowerCase() === candidate.identityRegistryAddress.toLowerCase()
}
