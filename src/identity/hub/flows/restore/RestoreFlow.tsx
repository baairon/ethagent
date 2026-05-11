import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { theme } from '../../../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../../../registry/erc8004.js'
import {
  isCurrentAgentCandidate,
  tokenCandidateHint,
  tokenCandidateSelectLabel,
} from '../../model/identity.js'
import { networkLabel } from '../../model/network.js'
import { shortAddress } from '../../model/format.js'
import { registryConfigFromConfig } from '../../../registry/registryConfig.js'
import type { Step } from '../../identityHubReducer.js'
import { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'
import { BusyScreen } from '../../components/BusyScreen.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'
import type { EthagentConfig } from '../../../../storage/config.js'
import { restoreSignatureRequestForStep } from '../../effects/restore/index.js'
import type { RestoreProgress } from '../../effects/types.js'

type RestoreStep = Exclude<Extract<Step, { kind: `restore-${string}` }>, { kind: 'restore-wallet' | 'restore-network' }>

type RestoreFlowProps = {
  step: RestoreStep
  config?: EthagentConfig
  walletSession: BrowserWalletReady | null
  restoreProgress: RestoreProgress | null
  onRestoreRegistrySubmit: (value: string) => void
  onRetryDiscovery: () => void
  onTokenSelect: (tokenId: string) => void
  onEnsSubmit: (value: string) => void
  onTokenIdSubmit: (value: string) => void
  onPickRecoveryMethod: (choice: 'ens' | 'token-id') => void
  onBack: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export const RestoreFlow: React.FC<RestoreFlowProps> = ({
  step,
  config,
  walletSession,
  restoreProgress,
  onRestoreRegistrySubmit,
  onRetryDiscovery,
  onTokenSelect,
  onEnsSubmit,
  onTokenIdSubmit,
  onPickRecoveryMethod,
  onBack,
}) => {
  const purpose = 'purpose' in step ? step.purpose ?? 'restore' : 'restore'
  const isSwitch = purpose === 'switch'

  if (step.kind === 'restore-registry') {
    const resolution = registryConfigFromConfig(config)
    return (
      <Surface
        title={`${resolution.network ? networkLabel(resolution.network).charAt(0).toUpperCase() + networkLabel(resolution.network).slice(1) : ''} Agent Registry`}
        subtitle={step.error ? `Lookup failed: ${step.error}` : 'Paste the agent registry address for this network.'}
        footer={footerHint('enter discover · esc back')}
      >
        <Text color={theme.dim}>RPC defaults to {resolution.defaultRpcUrl}</Text>
        <TextInput
          initialValue={config?.erc8004?.identityRegistryAddress ?? ''}
          placeholder="0x registry address"
          validate={value => {
            try {
              normalizeErc8004RegistryConfig({
                chainId: resolution.chainId,
                rpcUrl: resolution.config?.rpcUrl ?? resolution.defaultRpcUrl,
                identityRegistryAddress: value.trim(),
              })
              return null
            } catch (err: unknown) {
              return (err as Error).message
            }
          }}
          onSubmit={onRestoreRegistrySubmit}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-discovering') {
    return (
      <BusyScreen
        title={isSwitch ? 'Finding Agents' : 'Finding Agents'}
        subtitle={step.ownerHandle}
        label="checking tokens this wallet directly owns..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-recovery-input') {
    return (
      <Surface
        title={isSwitch ? 'Load Agent' : 'Restore Agent'}
        subtitle="The connected wallet doesn't directly own an agent token on this network."
        footer={footerHint('enter select · esc back')}
      >
        <Text color={theme.dim}>If this wallet is an approved operator wallet, choose how to find the agent token.</Text>
        <Select<'ens' | 'token-id' | 'back'>
          options={[
            { value: 'ens', role: 'section', label: 'Recovery Key' },
            { value: 'ens', label: 'Enter ENS Name', hint: 'Resolve the agent via its ENS subdomain' },
            { value: 'token-id', label: 'Enter Token ID', hint: 'Look up the agent directly by ERC-8004 token ID' },
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: 'Pick a different network', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={value => value === 'back' ? onBack() : onPickRecoveryMethod(value)}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-ens-input') {
    return (
      <Surface
        title={isSwitch ? 'Load Agent' : 'Restore Agent'}
        subtitle="Enter the agent's ENS name to decrypt with an authorized operator wallet."
        footer={footerHint(step.busy ? 'Looking up...' : 'enter continue · esc back')}
      >
        <Text color={theme.dim}>The full agent subdomain, e.g. agent.example.eth.</Text>
        <TextInput
          placeholder="agent.example.eth"
          onSubmit={value => onEnsSubmit(value.trim())}
          onCancel={onBack}
        />
        {step.error ? <Text color={theme.accentError}>{step.error}</Text> : null}
      </Surface>
    )
  }

  if (step.kind === 'restore-token-id-input') {
    return (
      <Surface
        title={isSwitch ? 'Load Agent' : 'Restore Agent'}
        subtitle={`Enter the ERC-8004 token ID on ${networkLabelForRegistry(step.registry)}.`}
        footer={footerHint(step.busy ? 'Looking up...' : 'enter continue · esc back')}
      >
        <Text color={theme.dim}>The integer token ID assigned at mint.</Text>
        <TextInput
          placeholder="45744"
          onSubmit={value => onTokenIdSubmit(value.trim())}
          onCancel={onBack}
        />
        {step.error ? <Text color={theme.accentError}>{step.error}</Text> : null}
      </Surface>
    )
  }

  if (step.kind === 'restore-not-found') {
    const view = restoreNotFoundView(step)
    return (
      <Surface
        title={view.title}
        subtitle={view.subtitle}
        footer={footerHint('enter continue · esc back')}
      >
        <Text color={theme.dim}>{view.detail}</Text>
        <Select<'retry' | 'network'>
          options={[
            { value: 'retry', role: 'section', label: 'Next' },
            { value: 'retry', label: 'Retry Search', hint: 'Search token ownership and ERC-8004 restore access again' },
            { value: 'network', label: 'Choose Network', hint: 'Search a different ERC-8004 network' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'retry') onRetryDiscovery()
            else onBack()
          }}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-select-token') {
    return (
      <Surface
        title={isSwitch ? 'Load an Agent' : 'Choose Your Agent'}
        subtitle={step.ownerHandle}
        footer={footerHint('enter select · esc back')}
      >
        <Select<string>
          options={[
            { value: 'section:available-agents', role: 'section', label: 'Available Agents' },
            ...step.candidates.map(candidate => {
              const current = isSwitch && isCurrentAgentCandidate(config?.identity, candidate)
              return {
                value: candidate.agentId.toString(),
                label: tokenCandidateSelectLabel(candidate, current),
                hint: tokenCandidateHint(candidate),
              }
            }),
            { value: '__ens__', role: 'section', label: 'Recovery Key' },
            { value: '__ens__', label: 'Enter ENS Name', hint: 'Resolve the agent via its ENS subdomain' },
            { value: '__token-id__', label: 'Enter Token ID', hint: 'Look up the agent directly by ERC-8004 token ID' },
            { value: '__back__', role: 'section', label: 'Navigation' },
            { value: '__back__', label: 'Back', hint: 'Return to the previous step', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={value => {
            if (value === '__ens__') onPickRecoveryMethod('ens')
            else if (value === '__token-id__') onPickRecoveryMethod('token-id')
            else if (value === '__back__') onBack()
            else onTokenSelect(value)
          }}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-fetching') {
    return (
      <BusyScreen
        title={isSwitch ? 'Loading Agent' : 'Restoring Your Agent'}
        subtitle="IPFS"
        label="opening encrypted state from IPFS..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-authorizing') {
    const view = restoreAuthorizationView(step, isSwitch)
    if (restoreProgress) {
      return (
        <BusyScreen
          title={view.progressTitle}
          subtitle="Wallet Signature Received"
          label={restoreProgress.label}
        />
      )
    }
    return (
      <WalletApprovalScreen
        title={view.title}
        subtitle={view.subtitle}
        walletSession={walletSession}
        label={view.label}
        onCancel={onBack}
      />
    )
  }

  return null
}

function networkLabelForRegistry(registry: { chainId: number }): string {
  const network = registry.chainId === 1 ? 'mainnet'
    : registry.chainId === 8453 ? 'base'
      : undefined
  return network ? networkLabel(network) : `chain ${registry.chainId}`
}

function restoreNotFoundView(
  step: Extract<RestoreStep, { kind: 'restore-not-found' }>,
): { title: string; subtitle: string; detail: string } {
  const network = networkLabelForRegistry(step.registry)
  const address = step.requesterAddress ?? step.ownerHandle
  if (step.reason === 'cancelled') {
    return {
      title: 'Search Cancelled',
      subtitle: `Stopped scanning ${network} for ${shortAddress(address)}.`,
      detail: 'No restore target was selected. Retry to keep searching, or choose a different network.',
    }
  }
  if (step.reason === 'no-owner-or-operator') {
    return {
      title: 'No Agent Access Found',
      subtitle: `${shortAddress(address)} has no ERC-8004 agent access on ${network}.`,
      detail: step.requesterAddress
        ? 'Checked token ownership and indexed ERC-8004 restore metadata. This wallet owns no agent token and is not listed as an operator wallet.'
        : 'Checked token ownership for this name. Operator-wallet metadata lookup requires a wallet address.',
    }
  }
  return {
    title: 'Agent Search Incomplete',
    subtitle: `ERC-8004 ownership or restore metadata could not be checked completely on ${network}.`,
    detail: 'No restore target was selected. Retry the search or choose another network.',
  }
}

function restoreAuthorizationView(
  step: Extract<RestoreStep, { kind: 'restore-authorizing' }>,
  isSwitch: boolean,
): { title: string; subtitle: string; label: string; progressTitle: string } {
  const owner = step.candidate.ownerAddress
  let requester: string | undefined = step.requesterAddress
  let role: 'owner-wallet' | 'operator-wallet' = 'owner-wallet'
  try {
    const request = restoreSignatureRequestForStep(step)
    requester = request.expectedAccount
    role = request.role
  } catch {
    requester = step.requesterAddress
  }

  if (role === 'operator-wallet' && requester) {
    return {
      title: 'Operator Wallet Required',
      subtitle: `Sign with the operator wallet ${shortAddress(requester)} to decrypt this snapshot.`,
      label: 'waiting for operator wallet signature...',
      progressTitle: isSwitch ? 'Loading Agent' : 'Restoring Your Agent',
    }
  }

  return {
    title: 'Owner Wallet Required',
    subtitle: `This encrypted snapshot requires the owner wallet ${shortAddress(owner)}.`,
    label: 'waiting for owner wallet signature...',
    progressTitle: isSwitch ? 'Loading Agent' : 'Restoring Your Agent',
  }
}
