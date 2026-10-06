import React from 'react'
import { Box, Text } from 'ink'
import { isAddress } from 'viem'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { Spinner } from '../../../ui/Spinner.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../../registry/erc8004.js'
import {
  isCurrentAgentCandidate,
  tokenCandidateSelectLabel,
} from '../profile/identity.js'
import { networkName } from '../shared/model/network.js'
import { shortAddress } from '../shared/model/format.js'
import { registryConfigFromConfig } from '../../registry/registryConfig.js'
import type { Step } from '../reducer.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { BusyScreen } from '../shared/components/BusyScreen.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { EthagentConfig } from '../../../storage/config.js'
import { restoreSignatureRequestForStep } from './auth.js'
import type { RestoreProgress } from '../shared/effects/types.js'

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

function displayHandle(handle: string): string {
  return isAddress(handle, { strict: false }) ? shortAddress(handle) : handle
}

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
  const flowTitle = isSwitch ? 'Switch Agent' : 'Restore Agent'

  if (step.kind === 'restore-registry') {
    const resolution = registryConfigFromConfig(config)
    return (
      <Surface
        title={`${networkName(resolution.chainId)} Agent Registry`}
        subtitle={step.error ? `Lookup failed: ${step.error}` : 'Paste the agent registry address for this network.'}
        footer={footerHint('↵ continue · esc back')}
      >
        <Box marginBottom={1}><Text color={theme.dim}>RPC defaults to {resolution.defaultRpcUrl}</Text></Box>
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
        title={flowTitle}
        subtitle={`Finding agents for ${displayHandle(step.ownerHandle)} on ${networkName(step.registry.chainId)}.`}
        label="Checking which agents this wallet can open…"
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-recovery-input') {
    return (
      <Surface
        title={flowTitle}
        subtitle="This wallet holds no agent token. Find the agent by its ENS name or token id instead."
        footer={footerHint('↵ select · esc back')}
      >
        <Select<'ens' | 'token-id' | 'back'>
          options={[
            { value: 'ens', label: 'Enter ENS Name' },
            { value: 'token-id', label: 'Enter Token ID', hint: `On ${networkName(step.registry.chainId)}` },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={value => value === 'back' ? onBack() : onPickRecoveryMethod(value)}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-ens-input' || step.kind === 'restore-token-id-input') {
    const byEns = step.kind === 'restore-ens-input'
    if (step.busy) {
      return (
        <Surface title={flowTitle} subtitle="Looking up the agent onchain." footer={footerHint('esc cancel')}>
          <Spinner label={byEns ? 'Resolving the ENS name…' : 'Looking up the token…'} />
        </Surface>
      )
    }
    return (
      <Surface
        title={flowTitle}
        subtitle={byEns ? 'Enter the agent\'s ENS name.' : `Enter the agent's token id on ${networkName(step.registry.chainId)}.`}
        footer={footerHint('↵ continue · esc back')}
      >
        {step.error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{step.error}</Paragraph></Box> : null}
        <TextInput
          placeholder={byEns ? 'name.eth' : 'token id'}
          onSubmit={value => byEns ? onEnsSubmit(value.trim()) : onTokenIdSubmit(value.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'restore-not-found') {
    const view = restoreNotFoundView(step)
    return (
      <Surface title={view.title} subtitle={view.subtitle} footer={footerHint('↵ select · esc back')}>
        {view.detail ? <Box marginBottom={1}><Paragraph color={theme.dim}>{view.detail}</Paragraph></Box> : null}
        <Select<'retry' | 'network'>
          options={[
            { value: 'retry', label: 'Search Again' },
            { value: 'network', label: 'Choose Another Network' },
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
        title={isSwitch ? 'Switch Agent' : 'Choose Your Agent'}
        subtitle={`Agents ${displayHandle(step.ownerHandle)} can open on ${networkName(step.registry.chainId)}.`}
        footer={footerHint('↵ select · esc back')}
      >
        <Select<string>
          options={[
            ...step.candidates.map(candidate => {
              const current = isSwitch && isCurrentAgentCandidate(config?.identity, candidate)
              const restorable = Boolean(candidate.backup?.cid)
              return {
                value: candidate.agentId.toString(),
                label: tokenCandidateSelectLabel(candidate, current),
                hint: restorable ? `#${candidate.agentId.toString()}` : `#${candidate.agentId.toString()} · no snapshot`,
                disabled: !restorable,
              }
            }),
            { value: '__spacer__', role: 'section' as const, label: '' },
            { value: '__ens__', label: 'Enter ENS Name' },
            { value: '__token-id__', label: 'Enter Token ID' },
            { value: '__back__', label: 'Back', role: 'utility' },
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
        title={flowTitle}
        subtitle="Downloading the encrypted snapshot from IPFS."
        label="Downloading…"
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'restore-authorizing') {
    const view = restoreAuthorizationView(step)
    if (restoreProgress) {
      return (
        <BusyScreen
          title={flowTitle}
          subtitle="Signature received."
          label={restoreProgress.label}
        />
      )
    }
    return (
      <WalletApprovalScreen
        title={view.title}
        subtitle={view.subtitle}
        walletSession={walletSession}
        label="Waiting for your signature…"
        onCancel={onBack}
      />
    )
  }

  return null
}

function restoreNotFoundView(
  step: Extract<RestoreStep, { kind: 'restore-not-found' }>,
): { title: string; subtitle: string; detail: string } {
  const network = networkName(step.registry.chainId)
  const address = displayHandle(step.requesterAddress ?? step.ownerHandle)
  if (step.reason === 'cancelled') {
    return {
      title: 'Search Stopped',
      subtitle: `Stopped searching ${network} for ${address}.`,
      detail: '',
    }
  }
  if (step.reason === 'no-owner-or-operator') {
    return {
      title: 'No Agents Found',
      subtitle: `${address} holds no agent token on ${network} and is not an operator for one.`,
      detail: step.requesterAddress ? '' : 'Operator wallets are only checked when you connect a wallet.',
    }
  }
  return {
    title: 'Agent Search Incomplete',
    subtitle: `The search on ${network} could not finish.`,
    detail: '',
  }
}

function restoreAuthorizationView(
  step: Extract<RestoreStep, { kind: 'restore-authorizing' }>,
): { title: string; subtitle: string } {
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
      title: 'Sign with Your Operator Wallet',
      subtitle: `Sign with ${shortAddress(requester)} to open this snapshot. Signing is free.`,
    }
  }

  return {
    title: 'Sign with Your Owner Wallet',
    subtitle: `Only the owner wallet ${shortAddress(owner)} can open this snapshot. Signing is free.`,
  }
}
