import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { TextInput } from '../../ui/TextInput.js'
import { theme } from '../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../erc8004.js'
import {
  isCurrentAgentCandidate,
  networkLabel,
  tokenCandidateHint,
  tokenCandidateSelectLabel,
} from '../identityHubModel.js'
import { registryConfigFromConfig } from '../registryConfig.js'
import type { Step } from '../identityHubReducer.js'
import { WalletApprovalScreen } from './WalletApprovalScreen.js'
import { BusyScreen } from './BusyScreen.js'
import type { BrowserWalletReady } from '../browserWallet.js'
import type { EthagentConfig } from '../../storage/config.js'

type RestoreStep = Exclude<Extract<Step, { kind: `restore-${string}` }>, { kind: 'restore-wallet' | 'restore-network' }>

type RestoreFlowProps = {
  step: RestoreStep
  config?: EthagentConfig
  walletSession: BrowserWalletReady | null
  onConnectWallet: () => void
  onRestoreRegistrySubmit: (value: string) => void
  onTokenIdSubmit: (value: string) => void
  onTokenSelect: (tokenId: string) => void
  onBack: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export const RestoreFlow: React.FC<RestoreFlowProps> = ({
  step,
  config,
  walletSession,
  onConnectWallet,
  onRestoreRegistrySubmit,
  onTokenIdSubmit,
  onTokenSelect,
  onBack,
}) => {
  const purpose = 'purpose' in step ? step.purpose ?? 'restore' : 'restore'
  const isSwitch = purpose === 'switch'

  if (step.kind === 'restore-owner') {
    return (
      <Surface
        title={isSwitch ? 'Switch Agent Identity' : 'Restore an Agent'}
        subtitle="Connect the wallet that owns the agent you want to load."
        footer={footerHint('enter select · esc back')}
      >
        <Select<'connect'>
          options={[
            { value: 'connect', role: 'section', prefix: '--', label: 'Wallet' },
            { value: 'connect', label: 'connect wallet', hint: 'search tokens owned by browser wallet' },
          ]}
          hintLayout="inline"
          onSubmit={onConnectWallet}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-registry') {
    const resolution = registryConfigFromConfig(config)
    return (
      <Surface
        title={`${resolution.network ? networkLabel(resolution.network).charAt(0).toUpperCase() + networkLabel(resolution.network).slice(1) : ''} Agent Registry`}
        subtitle={step.error ? `lookup failed: ${step.error}` : 'Paste the agent registry address for this network.'}
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
        title={isSwitch ? 'Finding Agent Identities' : 'Finding Agents'}
        subtitle={step.ownerHandle}
        label="searching this network..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-token-id') {
    return (
      <Surface
        title="Enter Agent Token ID"
        subtitle={step.error ?? `${networkLabelForRegistry(step.registry)} lookup needs the token id.`}
        footer={footerHint('enter continue · esc back')}
      >
        <TextInput
          placeholder="#45744"
          validate={value => parseTokenIdInput(value) ? null : 'enter a token id'}
          onSubmit={value => onTokenIdSubmit(value.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-select-token') {
    return (
      <Surface
        title={isSwitch ? 'Switch to an Agent' : 'Choose Your Agent'}
        subtitle={step.ownerHandle}
        footer={footerHint('enter select · esc back')}
      >
        <Select<string>
          options={[
            { value: 'section:owned-agents', role: 'section', prefix: '--', label: 'Owned agents' },
            ...step.candidates.map(candidate => {
              const current = isSwitch && isCurrentAgentCandidate(config?.identity, candidate)
              return {
                value: candidate.agentId.toString(),
                label: tokenCandidateSelectLabel(candidate, current),
                hint: tokenCandidateHint(candidate),
              }
            }),
          ]}
          hintLayout="inline"
          onSubmit={onTokenSelect}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-fetching') {
    return (
      <BusyScreen
        title={isSwitch ? 'Switching Agent Identity' : 'Restoring Your Agent'}
        subtitle="IPFS"
        label="opening encrypted state from IPFS..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-authorizing') {
    return (
      <WalletApprovalScreen
        title={isSwitch ? 'Approve Switch' : 'Approve Restore'}
        subtitle={isSwitch ? 'Use the wallet that owns this agent to switch.' : 'Use the wallet that owns this agent.'}
        walletSession={walletSession}
        label="waiting for approval..."
        onCancel={onBack}
      />
    )
  }

  return null
}

function parseTokenIdInput(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '')
  return /^\d+$/.test(normalized) ? normalized : null
}

function networkLabelForRegistry(registry: { chainId: number }): string {
  const network = registry.chainId === 1 ? 'mainnet'
    : registry.chainId === 42161 ? 'arbitrum'
      : registry.chainId === 8453 ? 'base'
        : registry.chainId === 10 ? 'optimism'
          : registry.chainId === 137 ? 'polygon'
            : undefined
  return network ? networkLabel(network) : `chain ${registry.chainId}`
}
