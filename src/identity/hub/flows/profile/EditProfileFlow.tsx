import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { theme } from '../../../../ui/theme.js'
import type { AgentEnsRecordState, AgentEnsRecords } from '../../../ens/agentRecords.js'
import type { EnsSetupPlan } from '../../../ens/ensAutomation.js'
import type { Step } from '../../identityHubReducer.js'
import { readIdentityStateString } from '../../model/custody.js'
import { FlowTimeline } from '../../components/FlowTimeline.js'
import { validateAgentIconReference } from '../../../profile/agentIcon.js'
import { EnsEditFlow, type EnsLinkOptions } from '../ens/EnsEditFlow.js'
import type { AgentReconciliation } from '../../reconciliation/index.js'

type EditProfileFlowProps = {
  step: Extract<Step, { kind: 'edit-profile-name' | 'edit-profile-description' | 'edit-profile-image' | 'edit-profile-review' | 'edit-profile-ens' }>
  reconciliation: AgentReconciliation
  onNameSubmit: (name: string) => void
  onDescriptionSubmit: (description: string) => void
  onIconSubmit: (iconPath?: string) => void
  onIconPick: () => void
  onReviewSave: () => void
  onEnsLink: (fullName: string, options: EnsLinkOptions) => void
  onEnsUnlink: () => void
  onEnsRecordsUpdate: (fullName: string, records: AgentEnsRecords, options: EnsLinkOptions, clearRecords?: boolean, currentRecords?: AgentEnsRecordState) => void
  onEnsSetup: (setup: EnsSetupPlan) => void
  onManageOperatorWalletAccess: () => void
  onWithdrawToken: () => void
  onBack: () => void
  onMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>
export const EDIT_PROFILE_STEPS = ['Name', 'Description', 'Icon', 'Review', 'Save']
const EDIT_NEXT_FOOTER = 'enter next · esc back'
const EDIT_DESCRIPTION_FOOTER = 'enter next · shift+enter newline · esc back'

export const EditProfileFlow: React.FC<EditProfileFlowProps> = ({
  step,
  reconciliation,
  onNameSubmit,
  onDescriptionSubmit,
  onIconSubmit,
  onIconPick,
  onReviewSave,
  onEnsLink,
  onEnsUnlink,
  onEnsRecordsUpdate,
  onEnsSetup,
  onManageOperatorWalletAccess,
  onWithdrawToken,
  onBack,
  onMenu,
}) => {
  if (step.kind === 'edit-profile-name') {
    const currentName = step.name ?? readIdentityStateString(step.identity.state, 'name')
    return (
      <Surface
        title="Edit Name, Description, Icon"
        subtitle={<FlowTimeline steps={EDIT_PROFILE_STEPS} current={1} />}
        footer={footerHint(EDIT_NEXT_FOOTER)}
      >
        <Text color={theme.dim}>Saved: {readIdentityStateString(step.identity.state, 'name') || '(unnamed)'}</Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-profile-name"
            initialValue={currentName}
            placeholder="agent name"
            validate={value => value.trim().length >= 2 ? null : 'name must be at least 2 characters'}
            onSubmit={value => onNameSubmit(value.trim())}
            onCancel={onMenu}
          />
        </Box>
      </Surface>
    )
  }

  if (step.kind === 'edit-profile-image') {
    return <AgentIconStep step={step} onIconSubmit={onIconSubmit} onIconPick={onIconPick} onBack={onBack} />
  }

  if (step.kind === 'edit-profile-review') {
    return (
      <EditProfileReviewStep
        step={step}
        onSave={onReviewSave}
        onBack={onBack}
      />
    )
  }

  if (step.kind === 'edit-profile-ens') {
    return (
      <EnsEditFlow
        identity={step.identity}
        registry={step.registry}
        reconciliation={reconciliation}
        onEnsLink={onEnsLink}
        onEnsUnlink={onEnsUnlink}
        onEnsRecordsUpdate={onEnsRecordsUpdate}
        onEnsSetup={onEnsSetup}
        onManageOperatorWalletAccess={onManageOperatorWalletAccess}
        onWithdrawToken={onWithdrawToken}
        initialView={step.initialView}
        onBack={onBack}
      />
    )
  }

  const currentDescription = readIdentityStateString(step.identity.state, 'description')
  const draftDescription = step.description ?? currentDescription
  return (
    <Surface
      title="Edit Name, Description, Icon"
      subtitle={<FlowTimeline steps={EDIT_PROFILE_STEPS} current={2} />}
      footer={footerHint(EDIT_DESCRIPTION_FOOTER)}
    >
      <Text color={theme.dim}>Saved: {currentDescription || '(no description)'}</Text>
      <Box marginTop={1}>
        <TextInput
          key="edit-profile-description"
          initialValue={draftDescription}
          placeholder="description"
          allowEmpty
          multiline
          onSubmit={value => onDescriptionSubmit(value.trim())}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

const AgentIconStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-image' }>
  onIconSubmit: (iconPath?: string) => void
  onIconPick: () => void
  onBack: () => void
}> = ({ step, onIconSubmit, onIconPick, onBack }) => {
  const [entryMode, setEntryMode] = React.useState(false)
  const currentIcon = readIdentityStateString(step.identity.state, 'imageUrl')
  const selectedIcon = describeDraftIcon(step.imagePath, currentIcon)

  if (entryMode) {
    return (
      <Surface
        title="Edit Name, Description, Icon"
        subtitle={<FlowTimeline steps={EDIT_PROFILE_STEPS} current={3} />}
        footer={footerHint(EDIT_NEXT_FOOTER)}
      >
        <Text color={theme.dim}>Current: {currentIcon ? shortIconReference(currentIcon) : '(no icon)'}</Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-profile-icon-entry"
            placeholder="https://.../icon.png or C:\\path\\icon.png"
            validate={validateAgentIconReference}
            onSubmit={value => onIconSubmit(value.trim())}
            onCancel={onBack}
          />
        </Box>
      </Surface>
    )
  }

  return (
    <Surface
      title="Edit Name, Description, Icon"
      subtitle={<FlowTimeline steps={EDIT_PROFILE_STEPS} current={3} />}
      footer={footerHint('enter select · esc back')}
    >
      <Box flexDirection="column">
        <Text color={theme.dim}>Agent Icon: {selectedIcon}</Text>
        {step.error ? <Text color={theme.accentError}>{step.error}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Select<'choose' | 'enter' | 'skip' | 'delete' | 'back'>
          options={[
            { value: 'choose', role: 'section', label: 'Icon Source' },
            { value: 'choose', label: 'Choose Local File', hint: 'Open the operating system file picker' },
            { value: 'enter', label: 'Enter URL Or Path', hint: 'Use https, ipfs, or a local media path' },
            { value: 'skip', role: 'section', label: 'Current Icon' },
            { value: 'skip', label: currentIcon ? 'Keep Current Icon' : 'No Icon', hint: 'Continue without changing the icon' },
            { value: 'delete', label: 'Remove Agent Icon', hint: 'Clear the public profile icon', disabled: !currentIcon },
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: 'Return to description', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'choose') return onIconPick()
            if (choice === 'enter') { setEntryMode(true); return }
            if (choice === 'delete') return onIconSubmit('delete')
            if (choice === 'skip') return onIconSubmit(undefined)
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

const EditProfileReviewStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-review' }>
  onSave: () => void
  onBack: () => void
}> = ({ step, onSave, onBack }) => {
  const currentIcon = readIdentityStateString(step.identity.state, 'imageUrl')
  return (
    <Surface
      title="Edit Name, Description, Icon"
      subtitle={<FlowTimeline steps={EDIT_PROFILE_STEPS} current={4} />}
      footer={footerHint('enter save · esc back')}
    >
      <Box flexDirection="column">
        <ReviewRow label="Name" value={step.name || '(unnamed)'} />
        <ReviewRow label="Description" value={step.description || '(no description)'} />
        <ReviewRow label="Agent Icon" value={describeDraftIcon(step.imagePath, currentIcon)} />
      </Box>
      <Box marginTop={1}>
        <Select<'save' | 'back'>
          options={[
            { value: 'save', label: 'Save Public Profile', hint: 'Publish public profile and update the token URI' },
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: 'Return to Agent Icon', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => choice === 'save' ? onSave() : onBack()}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

const ReviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const lines = value.split('\n')
  return (
    <Box flexDirection="row">
      <Box width={13} flexShrink={0}>
        <Text color={theme.dim}>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {lines.map((line, i) => (
          <Text key={i} color={theme.text}>{line || ' '}</Text>
        ))}
      </Box>
    </Box>
  )
}

function describeDraftIcon(imagePath: string | undefined, currentIcon: string): string {
  if (imagePath === 'delete') return 'Remove current icon'
  if (imagePath) return shortIconReference(imagePath)
  return currentIcon ? shortIconReference(currentIcon) : '(no icon)'
}

function shortIconReference(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 56) return trimmed
  const url = shortUrlReference(trimmed)
  if (url) return url
  return `${trimmed.slice(0, 24)}...${trimmed.slice(-20)}`
}

function shortUrlReference(value: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    const file = parts.at(-1)
    if (!file) return `${url.protocol}//${url.hostname}`
    return `${url.protocol}//${url.hostname}/.../${file}`
  } catch {
    if (!/^ipfs:\/\//i.test(value)) return null
    return `${value.slice(0, 22)}...${value.slice(-18)}`
  }
}
