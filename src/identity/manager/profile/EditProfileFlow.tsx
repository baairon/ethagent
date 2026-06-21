import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { TextArea } from '../../../ui/TextArea.js'
import { theme } from '../../../ui/theme.js'
import type { AgentEnsRecordState, AgentEnsRecords } from '../../ens/agentRecords.js'
import type { EnsSetupPlan } from '../../ens/ensAutomation.js'
import type { Step } from '../reducer.js'
import { readIdentityStateString } from '../custody/state.js'
import { validateAgentIconReference } from '../../profile/agentIcon.js'
import { EnsEditFlow, type EnsLinkOptions } from '../ens/EnsEditFlow.js'
import type { AgentReconciliation } from '../shared/reconciliation/index.js'

type EditProfileStepKind =
  | 'edit-profile-menu'
  | 'edit-profile-name'
  | 'edit-profile-description'
  | 'edit-profile-image'
  | 'edit-profile-review'
  | 'edit-profile-ens'

type EditProfileFlowProps = {
  step: Extract<Step, { kind: EditProfileStepKind }>
  reconciliation: AgentReconciliation
  onSelectField: (field: 'name' | 'description' | 'image') => void
  onSaveProfile: () => void
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
  onBack: () => void
  onMenu: () => void
  onBackToEditMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.menuStatus}>{hint}</Text>

export const EditProfileFlow: React.FC<EditProfileFlowProps> = ({
  step,
  reconciliation,
  onSelectField,
  onSaveProfile,
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
  onBack,
  onMenu,
  onBackToEditMenu,
}) => {
  if (step.kind === 'edit-profile-menu') {
    return <EditProfileMenuStep step={step} onSelectField={onSelectField} onSaveProfile={onSaveProfile} onBack={onBack} />
  }

  if (step.kind === 'edit-profile-name') {
    const currentName = step.name ?? readIdentityStateString(step.identity.state, 'name')
    return (
      <Surface title="Edit Name" footer={footerHint('↵ save · esc back')}>
        <Text color={theme.menuStatus}>Saved: {readIdentityStateString(step.identity.state, 'name') || '(unnamed)'}</Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-profile-name"
            initialValue={currentName}
            placeholder="agent name"
            validate={value => value.trim().length >= 2 ? null : 'name must be at least 2 characters'}
            onSubmit={value => onNameSubmit(value.trim())}
            onCancel={onBackToEditMenu}
          />
        </Box>
      </Surface>
    )
  }

  if (step.kind === 'edit-profile-image') {
    return <AgentIconStep step={step} onIconSubmit={onIconSubmit} onIconPick={onIconPick} onBack={onBack} onMenu={onBackToEditMenu} />
  }

  if (step.kind === 'edit-profile-review') {
    return <EditProfileReviewStep step={step} onSave={onReviewSave} onBack={onBackToEditMenu} />
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
        initialView={step.initialView}
        onBack={onBack}
      />
    )
  }

  const currentDescription = readIdentityStateString(step.identity.state, 'description')
  const draftDescription = step.description ?? currentDescription
  return (
    <Surface title="Edit Description">
      <Text color={theme.menuStatus}>Saved: {currentDescription || '(no description)'}</Text>
      <Box marginTop={1}>
        <TextArea
          key="edit-profile-description"
          initialValue={draftDescription}
          placeholder="describe this agent"
          onSubmit={value => onDescriptionSubmit(value.trim())}
          onCancel={onBackToEditMenu}
        />
      </Box>
    </Surface>
  )
}

const EditProfileMenuStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-menu' }>
  onSelectField: (field: 'name' | 'description' | 'image') => void
  onSaveProfile: () => void
  onBack: () => void
}> = ({ step, onSelectField, onSaveProfile, onBack }) => {
  const savedName = readIdentityStateString(step.identity.state, 'name')
  const savedDescription = readIdentityStateString(step.identity.state, 'description')
  const savedIcon = readIdentityStateString(step.identity.state, 'imageUrl')

  const draftName = step.name ?? savedName
  const draftDescription = step.description ?? savedDescription
  const draftIcon = describeDraftIcon(step.imagePath, savedIcon)

  const nameHint = draftName || '(unnamed)'
  const descriptionHint = draftDescription || '(no description)'
  const iconHint = step.imagePath !== undefined
    ? `${draftIcon} (draft)`
    : savedIcon
      ? draftIcon
      : '(no icon)'

  const dirty = step.name !== undefined || step.description !== undefined || step.imagePath !== undefined
  const saveHint = dirty ? 'Review what gets published' : 'No changes to save'

  return (
    <Surface title="Edit Profile" subtitle="Saving also snapshots your soul, memory, and skills onchain." footer={footerHint('↵ select · esc back')}>
      <Select<'name' | 'description' | 'image' | 'save' | 'back'>
        options={[
          { value: 'name', label: 'Name', hint: nameHint },
          { value: 'description', label: 'Description', hint: descriptionHint },
          { value: 'image', label: 'Icon', hint: iconHint },
          { value: 'save', label: 'Save Profile', hint: saveHint, disabled: !dirty },
          { value: 'back', label: 'Back', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'name') return onSelectField('name')
          if (choice === 'description') return onSelectField('description')
          if (choice === 'image') return onSelectField('image')
          if (choice === 'save') return onSaveProfile()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Surface>
  )
}

const AgentIconStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-image' }>
  onIconSubmit: (iconPath?: string) => void
  onIconPick: () => void
  onBack: () => void
  onMenu: () => void
}> = ({ step, onIconSubmit, onIconPick, onBack, onMenu }) => {
  const [entryMode, setEntryMode] = React.useState(false)
  const currentIcon = readIdentityStateString(step.identity.state, 'imageUrl')
  const selectedIcon = describeDraftIcon(step.imagePath, currentIcon)

  if (entryMode) {
    return (
      <Surface title="Edit Icon" footer={footerHint('↵ save · esc back')}>
        <Text color={theme.menuStatus}>Current: {currentIcon ? shortIconReference(currentIcon) : '(no icon)'}</Text>
        <Box marginTop={1}>
          <TextInput
            key="edit-profile-icon-entry"
            placeholder="https://.../icon.png or C:\\path\\icon.png"
            validate={validateAgentIconReference}
            onSubmit={value => onIconSubmit(value.trim())}
            onCancel={() => setEntryMode(false)}
          />
        </Box>
      </Surface>
    )
  }

  return (
    <Surface title="Edit Icon" footer={footerHint('↵ select · esc back')}>
      <Box flexDirection="column">
        <Text color={theme.menuStatus}>Agent Icon: {selectedIcon}</Text>
        {step.error ? <Text color={theme.accentError}>{step.error}</Text> : null}
      </Box>
      <Box marginTop={1}>
        <Select<'choose' | 'enter' | 'skip' | 'delete' | 'back'>
          options={[
            { value: 'choose', label: 'Choose Local File', hint: 'Open the file picker' },
            { value: 'enter', label: 'Enter URL Or Path', hint: 'https, ipfs, or local path' },
            { value: 'skip', label: currentIcon ? 'Keep Current Icon' : 'No Icon' },
            { value: 'delete', label: 'Remove Agent Icon', disabled: !currentIcon },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'choose') return onIconPick()
            if (choice === 'enter') { setEntryMode(true); return }
            if (choice === 'delete') return onIconSubmit('delete')
            if (choice === 'skip') return onIconSubmit(undefined)
            return onMenu()
          }}
          onCancel={onMenu}
        />
      </Box>
    </Surface>
  )
}

const EditProfileReviewStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-review' }>
  onSave: () => void
  onBack: () => void
}> = ({ onSave, onBack }) => {
  return (
    <Surface title="Review & Publish" subtitle="Publishing onchain:" footer={footerHint('↵ publish · esc back')}>
      <Box flexDirection="column">
        {['Name', 'Description', 'Agent icon', 'Soul, memory, and skills snapshot'].map(item => (
          <Text key={item} color={theme.text}>{`· ${item}`}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Select<'save' | 'back'>
          options={[
            { value: 'save', label: 'Publish' },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => choice === 'save' ? onSave() : onBack()}
          onCancel={onBack}
        />
      </Box>
    </Surface>
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
