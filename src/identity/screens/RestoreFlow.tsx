import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { TextInput } from '../../ui/TextInput.js'
import { theme } from '../../ui/theme.js'
import { isAddress } from 'viem'
import { normalizeErc8004RegistryConfig } from '../erc8004.js'
import { networkLabel, storageLabel, tokenCandidateHint, tokenCandidateLabel } from '../identityHubModel.js'
import { registryConfigFromConfig } from '../registryConfig.js'
import type { Step } from '../identityHubReducer.js'
import { WalletApprovalScreen } from './WalletApprovalScreen.js'
import { BusyScreen } from './BusyScreen.js'
import type { BrowserWalletReady } from '../browserWallet.js'
import type { EthagentConfig } from '../../storage/config.js'

type RestoreFlowProps = {
  step: Step
  config?: EthagentConfig
  walletSession: BrowserWalletReady | null
  onSetStep: (step: Step) => void
  onConnectWallet: () => void
  onOwnerSubmit: (ownerHandle: string) => void
  onRestoreRegistrySubmit: (value: string) => void
  onTokenIdSubmit: (value: string) => void
  onTokenSelect: (tokenId: string) => void
  onBack: () => void
  onMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

export const RestoreFlow: React.FC<RestoreFlowProps> = ({
  step,
  config,
  walletSession,
  onSetStep,
  onConnectWallet,
  onOwnerSubmit,
  onRestoreRegistrySubmit,
  onTokenIdSubmit,
  onTokenSelect,
  onBack,
  onMenu,
}) => {
  const purpose = 'purpose' in step ? step.purpose ?? 'restore' : 'restore'
  const isSwitch = purpose === 'switch'

  if (step.kind === 'restore-owner') {
    if (!step.initialOwnerHandle && step.mode !== 'manual') {
      return (
        <Surface
          title={isSwitch ? 'switch agent identity' : 'restore an agent'}
          subtitle="choose how ethagent should find the owner wallet."
          footer={footerHint('enter select Â· esc back')}
        >
          <Select<'connect' | 'manual'>
            options={[
              { value: 'connect', label: 'connect wallet', hint: 'use the selected browser wallet address' },
              { value: 'manual', label: 'enter address or ENS', hint: 'paste a wallet address or name.eth' },
            ]}
            onSubmit={choice => {
              if (choice === 'connect') return onConnectWallet()
              onSetStep({ kind: 'restore-owner', purpose: step.purpose, mode: 'manual' })
            }}
            onCancel={onMenu}
          />
        </Surface>
      )
    }
    return (
      <Surface
        title={isSwitch ? 'switch agent identity' : 'restore an agent'}
        subtitle={step.initialOwnerHandle ? 'confirm the wallet or ENS to search.' : 'enter the wallet or ENS that owns it.'}
        footer={footerHint('enter discover · esc back')}
      >
        <TextInput
          key={`restore-owner-${purpose}-${step.initialOwnerHandle ?? ''}`}
          initialValue={step.initialOwnerHandle ?? ''}
          placeholder="name.eth or 0x..."
          validate={validateOwnerHandleInput}
          onSubmit={ownerHandle => onOwnerSubmit(ownerHandle.trim())}
          onCancel={onMenu}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-registry') {
    const resolution = registryConfigFromConfig(config)
    return (
      <Surface
        title={`${networkLabel(resolution.network)} agent registry`}
        subtitle={step.error ? `lookup failed: ${step.error}` : 'paste the agent registry address for this network.'}
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
        title={isSwitch ? 'finding agent identities' : 'finding agents'}
        subtitle={step.ownerHandle}
        label="checking supported networks..."
        onCancel={onMenu}
      />
    )
  }

  if (step.kind === 'restore-token-id') {
    return (
      <Surface
        title="enter agent token id"
        subtitle={step.error ?? `${networkLabelForRegistry(step.registry)} lookup needs the token id.`}
        footer={footerHint('enter continue · esc hub')}
      >
        <TextInput
          placeholder="#45744"
          validate={value => parseTokenIdInput(value) ? null : 'enter a token id'}
          onSubmit={value => onTokenIdSubmit(value.trim())}
          onCancel={onMenu}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-select-token') {
    return (
      <Surface
        title={isSwitch ? 'switch to an agent' : 'choose your agent'}
        subtitle={step.ownerHandle}
        footer={footerHint('enter select · esc hub')}
      >
        <Select<string>
          options={step.candidates.map(candidate => ({
            value: candidate.agentId.toString(),
            label: tokenCandidateLabel(candidate),
            hint: tokenCandidateHint(candidate),
          }))}
          onSubmit={onTokenSelect}
          onCancel={onMenu}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-fetching') {
    return (
      <BusyScreen
        title={isSwitch ? 'switching agent identity' : 'restoring your agent'}
        subtitle={storageLabel(step.apiUrl)}
        label="opening encrypted state..."
        onCancel={onMenu}
      />
    )
  }

  if (step.kind === 'restore-authorizing') {
    return (
      <WalletApprovalScreen
        title={isSwitch ? 'approve switch' : 'approve restore'}
        subtitle={isSwitch ? 'use the wallet that owns this agent to switch.' : 'use the wallet that owns this agent.'}
        walletSession={walletSession}
        label="waiting for approval..."
        onCancel={onMenu}
      />
    )
  }

  return null
}

function parseTokenIdInput(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '')
  return /^\d+$/.test(normalized) ? normalized : null
}

export function validateOwnerHandleInput(value: string): string | null {
  const trimmed = value.trim()
  if (isAddress(trimmed)) return null
  if (isEnsName(trimmed)) return null
  return 'enter a valid Ethereum address or ENS name'
}

function isEnsName(value: string): boolean {
  if (value.length > 255) return false
  const labels = value.toLowerCase().split('.')
  if (labels.length < 2 || labels.some(label => label.length === 0)) return false
  if (labels.at(-1) !== 'eth') return false
  return labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
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
