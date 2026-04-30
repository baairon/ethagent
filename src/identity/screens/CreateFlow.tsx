import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { TextInput } from '../../ui/TextInput.js'
import { StepIndicator } from '../../ui/StepIndicator.js'
import { theme } from '../../ui/theme.js'
import { extractPinataJwt } from '../ipfs.js'
import { normalizeErc8004RegistryConfig } from '../erc8004.js'
import { networkLabel } from '../identityHubModel.js'
import type { Step } from '../identityHubReducer.js'
import { createStepNumber, CREATE_STEP_LABELS } from '../identityHubReducer.js'
import { WalletApprovalScreen } from './WalletApprovalScreen.js'
import { BusyScreen } from './BusyScreen.js'
import type { BrowserWalletReady } from '../browserWallet.js'

const PINATA_API_KEYS_URL = 'https://app.pinata.cloud/developers/api-keys'

type CreateFlowProps = {
  step: Extract<Step, {
    kind:
      | 'replace-confirm'
      | 'create-name'
      | 'create-description'
      | 'create-preflight'
      | 'create-registry'
      | 'create-signing'
      | 'create-storage'
  }>
  walletSession: BrowserWalletReady | null
  onSetStep: (step: Step) => void
  onNameSubmit: (name: string) => void
  onDescriptionSubmit: (name: string, description: string) => void
  onRegistrySubmit: (value: string) => void
  onStorageSubmit: (input: string) => void
  onStorageError: (error: string) => void
  onBack: () => void
  onMenu: () => void
}

export const CreateFlow: React.FC<CreateFlowProps> = ({
  step,
  walletSession,
  onSetStep,
  onNameSubmit,
  onDescriptionSubmit,
  onRegistrySubmit,
  onStorageSubmit,
  onBack,
  onMenu,
}) => {
  const stepNum = createStepNumber(step)
  const indicator = stepNum > 0
    ? <StepIndicator steps={CREATE_STEP_LABELS} current={stepNum} />
    : null

  if (step.kind === 'replace-confirm') {
    return (
      <Surface title="Create a New Agent?" footer="enter selects · esc back">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>
            Your current agent stays in your wallet and remains loadable.
          </Text>
          <Text color={theme.dim}>
            This mints a new agent to this wallet and uses it on this machine.
          </Text>
        </Box>
        <Select<'replace' | 'back'>
          options={[
            { value: 'back', role: 'section', prefix: '--', label: 'Current identity' },
            { value: 'back', label: 'keep current agent', hint: 'return to settings without minting anything', role: 'utility' },
            { value: 'replace', role: 'section', prefix: '--', label: 'New identity' },
            { value: 'replace', label: 'mint and use new agent', hint: 'create separate token and make it active' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'back') return onMenu()
            return onSetStep({ kind: 'create-name' })
          }}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-name') {
    return (
      <Surface title="Name Your Agent" subtitle={indicator} footer="enter continues · esc back">
        {step.error ? <Text color="#e87070">{step.error}</Text> : null}
        <TextInput
          key="agent-name"
          placeholder="agent name"
          validate={value => value.trim().length >= 2 ? null : 'name must be at least 2 characters'}
          onSubmit={name => onNameSubmit(name.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-description') {
    return (
      <Surface title="Describe Your Agent" subtitle={indicator} footer="enter continues · esc back">
        <Text color={theme.dim}>Optional. One short sentence is enough.</Text>
        <TextInput
          key="agent-description"
          placeholder="description"
          onSubmit={description => onDescriptionSubmit(step.name, description.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-preflight') {
    return (
      <BusyScreen
        title="Getting Ready"
        subtitle={indicator}
        label="checking IPFS storage and chain..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'create-registry') {
    return (
      <Surface
        title={`${step.resolution.network ? networkLabel(step.resolution.network).charAt(0).toUpperCase() + networkLabel(step.resolution.network).slice(1) : ''} Agent Registry`}
        subtitle={step.error ?? 'Paste the agent registry address for this network.'}
        footer="enter continues · esc back"
      >
        <Text color={theme.dim}>RPC defaults to {step.resolution.defaultRpcUrl}</Text>
        <TextInput
          key={`create-registry-${step.resolution.network}`}
          placeholder="0x registry address"
          validate={value => {
            try {
              normalizeErc8004RegistryConfig({ chainId: step.resolution.chainId, identityRegistryAddress: value.trim() })
              return null
            } catch (err: unknown) {
              return (err as Error).message
            }
          }}
          onSubmit={onRegistrySubmit}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-signing') {
    return (
      <WalletApprovalScreen
        title="Approve in Wallet"
        subtitle="One browser flow signs, saves the IPFS backup, and submits the token transaction."
        walletSession={walletSession}
        label="waiting for wallet approval..."
        onCancel={onBack}
      />
    )
  }

  return (
    <Surface
      title="Connect IPFS Storage"
      subtitle={step.error ?? 'Save a Pinata JWT so ethagent can pin encrypted state to IPFS.'}
      footer="enter continues · esc back"
    >
      <Text>
        <Text color={theme.dim}>Paste your Pinata JWT. Get one at </Text>
        <Text color={theme.accentPrimary} underline>{PINATA_API_KEYS_URL}</Text>
      </Text>
      <Text color={theme.dim}>Saved encrypted on this device · used only for IPFS pinning</Text>
      <TextInput
        key="create-storage"
        isSecret
        placeholder="Pinata JWT"
        validate={v => {
          try {
            extractPinataJwt(v)
            return null
          } catch (err: unknown) {
            return (err as Error).message
          }
        }}
        onSubmit={onStorageSubmit}
        onCancel={onBack}
      />
    </Surface>
  )
}
