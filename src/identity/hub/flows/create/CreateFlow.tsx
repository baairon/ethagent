import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { theme } from '../../../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../../../registry/erc8004.js'
import { networkLabel } from '../../model/network.js'
import type { Step } from '../../identityHubReducer.js'
import { createStepNumber, CREATE_STEP_LABELS } from '../../identityHubReducer.js'
import { WalletApprovalScreen } from '../../components/WalletApprovalScreen.js'
import { BusyScreen } from '../../components/BusyScreen.js'
import { FlowTimeline } from '../../components/FlowTimeline.js'
import { PinataJwtInput } from '../../components/PinataJwtInput.js'
import type { BrowserWalletReady } from '../../../wallet/browserWallet.js'

type CreateFlowProps = {
  step: Extract<Step, {
    kind:
      | 'replace-confirm'
      | 'create-name'
      | 'create-description'
      | 'create-custody'
      | 'create-preflight'
      | 'create-registry'
      | 'create-signing'
      | 'create-storage'
  }>
  walletSession: BrowserWalletReady | null
  onSetStep: (step: Step) => void
  onNameSubmit: (name: string) => void
  onDescriptionSubmit: (name: string, description: string) => void
  onCustodySubmit: (custodyMode: 'simple' | 'advanced') => void
  onRegistrySubmit: (value: string) => void
  onStorageSubmit: (input: string) => void
  onBack: () => void
  onMenu: () => void
}

export const CreateFlow: React.FC<CreateFlowProps> = ({
  step,
  walletSession,
  onSetStep,
  onNameSubmit,
  onDescriptionSubmit,
  onCustodySubmit,
  onRegistrySubmit,
  onStorageSubmit,
  onBack,
  onMenu,
}) => {
  const stepNum = createStepNumber(step)
  const indicator = stepNum > 0
    ? <FlowTimeline steps={[...CREATE_STEP_LABELS]} current={stepNum} />
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
            { value: 'back', role: 'section', label: 'Current Identity' },
            { value: 'back', label: 'Keep Current Agent', hint: 'Return without minting anything', role: 'utility' },
            { value: 'replace', role: 'section', label: 'New Identity' },
            { value: 'replace', label: 'Mint and Use New Agent', hint: 'Create separate token and make it active' },
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
        {step.error ? <Text color={theme.accentError}>{step.error}</Text> : null}
        <TextInput
          key="agent-name"
          initialValue={step.name ?? ''}
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
      <Surface title="Describe Your Agent" subtitle={indicator} footer="enter next · shift+enter newline · esc back">
        <Text color={theme.dim}>Optional. One short sentence is enough.</Text>
        <TextInput
          key="agent-description"
          initialValue={step.description ?? ''}
          placeholder="description"
          allowEmpty
          multiline
          onSubmit={description => onDescriptionSubmit(step.name, description.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-custody') {
    return (
      <Surface title="Pick Custody Mode" subtitle={indicator} footer="enter continues · esc back">
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.dim}>Custody decides who controls the ERC-8004 token and who can rotate the URI pointer.</Text>
          <Text color={theme.dim}>You can switch later from Identity Hub.</Text>
        </Box>
        <Select<'simple' | 'advanced'>
          options={[
            { value: 'simple', role: 'section', label: 'Simple (Recommended)' },
            { value: 'simple', label: 'Simple', hint: 'One wallet owns the token, signs every save, and rotates the URI directly' },
            { value: 'advanced', role: 'section', label: 'Advanced' },
            { value: 'advanced', label: 'Advanced', hint: 'Operator delegation vault holds the token; owner wallet controls vault, operator wallets get URI-rotation permission' },
          ]}
          hintLayout="inline"
          onSubmit={onCustodySubmit}
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
    const isAdvanced = step.custodyMode === 'advanced'
    return (
      <WalletApprovalScreen
        title={isAdvanced ? 'Connect Owner Wallet' : 'Sign in Wallet'}
        subtitle={
          isAdvanced
            ? 'This wallet will own the agent token and control the delegation vault. Operator wallets are configured after minting.'
            : 'One browser flow signs, saves the IPFS backup, and submits the token transaction.'
        }
        walletSession={walletSession}
        label={isAdvanced ? 'waiting for owner wallet...' : 'waiting for wallet signature...'}
        onCancel={onBack}
      />
    )
  }

  return (
    <PinataJwtInput
      inputKey="create-storage"
      title="Connect IPFS Storage"
      subtitle={step.error ?? undefined}
      footer="enter continues · esc back"
      onSubmit={onStorageSubmit}
      onCancel={onBack}
    />
  )
}
