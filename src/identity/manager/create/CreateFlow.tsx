import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { TextArea } from '../../../ui/TextArea.js'
import { theme } from '../../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../../registry/erc8004.js'
import { networkLabel } from '../shared/model/network.js'
import type { Step } from '../reducer.js'
import { createStepNumber, CREATE_STEP_LABELS } from '../reducer.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { BusyScreen } from '../shared/components/BusyScreen.js'
import { FlowTimeline } from '../shared/components/FlowTimeline.js'
import { PinataJwtInput } from '../shared/components/PinataJwtInput.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'

type CreateFlowProps = {
  step: Extract<Step, {
    kind:
      | 'replace-confirm'
      | 'create-name'
      | 'create-description'
      | 'create-custody'
      | 'create-import'
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
      <Surface title="Create a New Agent?" footer="↵ selects · esc back">
        <Select<'replace' | 'back'>
          options={[
            { value: 'back', label: 'Keep Current Agent', role: 'utility' },
            { value: 'replace', label: 'Mint and Use New Agent' },
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
      <Surface title="Name Your Agent" subtitle={indicator} footer="↵ continues · esc back">
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
      <Surface title="Describe Your Agent" subtitle={indicator}>
        <TextArea
          key="agent-description"
          initialValue={step.description ?? ''}
          placeholder="optional description"
          onSubmit={description => onDescriptionSubmit(step.name, description.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-custody') {
    return (
      <Surface title="Pick Custody Mode" subtitle={indicator} footer="↵ continues · esc back">
        <Select<'simple' | 'advanced'>
          options={[
            { value: 'simple', label: 'Simple (recommended)', hint: 'One wallet signs' },
            { value: 'advanced', label: 'Advanced', hint: 'Operators rotate URI' },
          ]}
          hintLayout="inline"
          onSubmit={onCustodySubmit}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-import') {
    if (!step.candidates) {
      return (
        <BusyScreen
          title="Checking Existing Notes"
          subtitle={indicator}
          label="scanning for notes to import..."
          onCancel={onBack}
        />
      )
    }
    const candidates = step.candidates
    const summary = candidates
      .map(candidate => `${candidate.source} (${candidate.contentLines} lines)`)
      .join(', ')
    const toPreflight = (importNotes?: typeof candidates) => onSetStep({
      kind: 'create-preflight',
      name: step.name,
      description: step.description,
      ...(step.network ? { network: step.network } : {}),
      custodyMode: step.custodyMode,
      ...(importNotes && importNotes.length ? { importNotes } : {}),
    })
    return (
      <Surface title="Import Existing Notes?" subtitle={indicator} footer="↵ selects · esc back">
        <Box flexDirection="column">
          <Text color={theme.textSubtle}>Found local notes not yet captured by any agent: {summary}.</Text>
          <Text color={theme.textSubtle}>Import folds them into this agent&apos;s MEMORY.md and the first encrypted snapshot.</Text>
        </Box>
        <Box marginTop={1}>
          <Select<'import' | 'skip'>
            options={[
              { value: 'import', label: 'Import Into New Agent', hint: 'Adds them to MEMORY.md' },
              { value: 'skip', label: 'Start Fresh', hint: 'Use blank scaffolding', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => toPreflight(choice === 'import' ? candidates : undefined)}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  if (step.kind === 'create-preflight') {
    return (
      <BusyScreen
        title="Getting Ready"
        subtitle={indicator}
        label="checking storage..."
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'create-registry') {
    return (
      <Surface
        title={`${step.resolution.network ? networkLabel(step.resolution.network).charAt(0).toUpperCase() + networkLabel(step.resolution.network).slice(1) : ''} Agent Registry`}
        subtitle={step.error ?? 'Paste the agent registry address for this network.'}
        footer="↵ continues · esc back"
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
            ? 'Owner wallet controls the Vault. Operators configured after minting.'
            : 'Signs backup and submits mint transaction.'
        }
        walletSession={walletSession}
        label={isAdvanced ? 'waiting for owner wallet to mint...' : 'waiting for wallet to mint...'}
        onCancel={onBack}
      />
    )
  }

  return (
    <PinataJwtInput
      inputKey="create-storage"
      title="Connect IPFS Storage"
      subtitle={step.error ?? undefined}
      footer="↵ continues · esc back"
      onSubmit={onStorageSubmit}
      onCancel={onBack}
    />
  )
}
