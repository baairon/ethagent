import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { TextArea } from '../../../ui/TextArea.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { theme } from '../../../ui/theme.js'
import { normalizeErc8004RegistryConfig } from '../../registry/erc8004.js'
import { networkName } from '../shared/model/network.js'
import type { Step } from '../reducer.js'
import { createStepNumber, CREATE_STEP_LABELS } from '../reducer.js'
import { WalletApprovalScreen } from '../shared/components/WalletApprovalScreen.js'
import { BusyScreen } from '../shared/components/BusyScreen.js'
import { StepHeader } from '../shared/components/StepHeader.js'
import { PinataJwtInput } from '../shared/components/PinataJwtInput.js'
import type { BrowserWalletReady } from '../../wallet/browserWallet.js'
import type { CreateProgress } from '../shared/effects/types.js'

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
  createProgress: CreateProgress | null
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
  createProgress,
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
  const header = (description?: React.ReactNode): React.ReactNode =>
    stepNum > 0
      ? <StepHeader steps={[...CREATE_STEP_LABELS]} current={stepNum} description={description} />
      : description ?? null

  if (step.kind === 'replace-confirm') {
    return (
      <Surface
        title="Create a New Agent?"
        subtitle="This machine switches to the new agent. Switch Agent brings the current one back later."
        footer="↵ select · esc back"
      >
        <Select<'replace' | 'back'>
          options={[
            { value: 'back', label: 'Keep Current Agent', role: 'utility' },
            { value: 'replace', label: 'Create a New Agent' },
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
      <Surface title="Name Your Agent" subtitle={header('Other agents and apps see this name.')} footer="↵ continue · esc back">
        {step.error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{step.error}</Paragraph></Box> : null}
        <TextInput
          key="agent-name"
          initialValue={step.name ?? ''}
          placeholder="Agent name"
          validate={value => value.trim().length >= 2 ? null : 'Use at least 2 characters.'}
          onSubmit={name => onNameSubmit(name.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-description') {
    return (
      <Surface title="Describe Your Agent" subtitle={header('Optional. A sentence or two for your Agent Card.')} footer="↵ continue · esc back">
        <TextArea
          key="agent-description"
          initialValue={step.description ?? ''}
          placeholder="What your agent does"
          onSubmit={description => onDescriptionSubmit(step.name, description.trim())}
          onCancel={onBack}
        />
      </Surface>
    )
  }

  if (step.kind === 'create-custody') {
    return (
      <Surface title="Choose Custody Mode" subtitle={header('Simple suits most agents. You can switch later.')} footer="↵ select · esc back">
        <Select<'simple' | 'advanced'>
          options={[
            { value: 'simple', label: 'Simple', hint: 'Your wallet holds the token' },
            { value: 'advanced', label: 'Advanced', hint: 'A Vault holds the token' },
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
          subtitle={header()}
          label="Looking for notes to import…"
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
      <Surface title="Import Existing Notes?" subtitle={header()} footer="↵ select · esc back">
        <Paragraph color={theme.textSubtle}>{`Found notes no agent has captured yet: ${summary}.`}</Paragraph>
        <Paragraph color={theme.textSubtle}>Importing adds them to MEMORY.md and the first encrypted snapshot.</Paragraph>
        <Box marginTop={1}>
          <Select<'import' | 'skip'>
            options={[
              { value: 'import', label: 'Import Notes', hint: 'Adds to MEMORY.md' },
              { value: 'skip', label: 'Start Fresh', hint: 'Empty soul and memory', role: 'utility' },
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
        subtitle={header()}
        label="Checking IPFS storage…"
        onCancel={onBack}
      />
    )
  }

  if (step.kind === 'create-registry') {
    return (
      <Surface
        title={`${networkName(step.resolution.chainId)} Agent Registry`}
        subtitle={header('Paste the agent registry address for this network.')}
        footer="↵ continue · esc back"
      >
        {step.error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{step.error}</Paragraph></Box> : null}
        <Box marginBottom={1}><Paragraph color={theme.dim}>{`RPC defaults to ${step.resolution.defaultRpcUrl}`}</Paragraph></Box>
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
    if (createProgress) {
      return (
        <BusyScreen
          title="Create Your Agent"
          subtitle={header('Your wallet sent the transaction. Keep this window open while it confirms.')}
          label={createProgress.label}
        />
      )
    }
    return (
      <WalletApprovalScreen
        title="Create Your Agent"
        subtitle={header(
          isAdvanced
            ? 'Your owner wallet mints the token and will control the Vault. Add operator wallets afterwards.'
            : 'Your wallet signs the first snapshot and mints the agent token. Minting needs gas.',
        )}
        walletSession={walletSession}
        label={isAdvanced ? 'Waiting for your owner wallet…' : 'Waiting for your wallet…'}
        onCancel={onBack}
      />
    )
  }

  return (
    <PinataJwtInput
      inputKey="create-storage"
      title="Connect IPFS Storage"
      subtitle={header('Snapshots are pinned to IPFS through your own Pinata account.')}
      {...(step.error ? { error: step.error } : {})}
      onSubmit={onStorageSubmit}
      onCancel={onBack}
    />
  )
}
