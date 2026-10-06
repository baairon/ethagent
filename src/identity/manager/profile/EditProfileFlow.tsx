import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { TextArea } from '../../../ui/TextArea.js'
import { theme } from '../../../ui/theme.js'
import { Paragraph } from '../../../ui/Paragraph.js'
import { useContentWidth } from '../../../ui/layout.js'
import { FieldList } from '../shared/components/FieldRow.js'
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
  onBackToEditMenu: () => void
}

const footerHint = (hint: string) => <Text color={theme.dim}>{hint}</Text>

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
  onBackToEditMenu,
}) => {
  if (step.kind === 'edit-profile-menu') {
    return <EditProfileMenuStep step={step} onSelectField={onSelectField} onSaveProfile={onSaveProfile} onBack={onBack} />
  }

  if (step.kind === 'edit-profile-name') {
    const currentName = step.name ?? readIdentityStateString(step.identity.state, 'name')
    return (
      <Surface title="Edit Name" subtitle={`Published name: ${readIdentityStateString(step.identity.state, 'name') || 'not set'}`} footer={footerHint('↵ save · esc back')}>
        <TextInput
          key="edit-profile-name"
          initialValue={currentName}
          placeholder="Agent name"
          validate={value => value.trim().length >= 2 ? null : 'Use at least 2 characters.'}
          onSubmit={value => onNameSubmit(value.trim())}
          onCancel={onBackToEditMenu}
        />
      </Surface>
    )
  }

  if (step.kind === 'edit-profile-image') {
    return <AgentIconStep step={step} onIconSubmit={onIconSubmit} onIconPick={onIconPick} onBack={onBackToEditMenu} />
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
    <Surface title="Edit Description" subtitle="A sentence or two for your Agent Card." footer={footerHint('↵ save · esc back')}>
      <TextArea
        key="edit-profile-description"
        initialValue={draftDescription}
        placeholder="What your agent does"
        onSubmit={value => onDescriptionSubmit(value.trim())}
        onCancel={onBackToEditMenu}
      />
    </Surface>
  )
}

const EditProfileMenuStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-menu' }>
  onSelectField: (field: 'name' | 'description' | 'image') => void
  onSaveProfile: () => void
  onBack: () => void
}> = ({ step, onSelectField, onSaveProfile, onBack }) => {
  const contentWidth = useContentWidth()
  const savedName = readIdentityStateString(step.identity.state, 'name')
  const savedDescription = readIdentityStateString(step.identity.state, 'description')
  const savedIcon = readIdentityStateString(step.identity.state, 'imageUrl')

  const draftName = step.name ?? savedName
  const draftDescription = step.description ?? savedDescription
  const draftIcon = describeDraftIcon(step.imagePath, savedIcon)

  const edited = (changed: boolean, value: string) => changed ? `${value} · edited` : value
  const nameHint = edited(step.name !== undefined, draftName || 'Not set')
  const hintBudget = contentWidth - 'Publish Profile'.length - 4 - (step.description !== undefined ? ' · edited'.length : 0)
  const descriptionHint = edited(step.description !== undefined, previewText(draftDescription || 'Not set', hintBudget))
  const iconHint = edited(step.imagePath !== undefined, draftIcon)

  const dirty = step.name !== undefined || step.description !== undefined || step.imagePath !== undefined
  const saveHint = dirty ? 'Review first' : 'No changes yet'

  return (
    <Surface title="Edit Profile" subtitle="Publishing also saves a snapshot of your soul, memory, and skills." footer={footerHint('↵ select · esc back')}>
      <Select<'name' | 'description' | 'image' | 'save' | 'back'>
        options={[
          { value: 'name', label: 'Name', hint: nameHint },
          { value: 'description', label: 'Description', hint: descriptionHint },
          { value: 'image', label: 'Icon', hint: iconHint },
          { value: 'save', label: 'Publish Profile', hint: saveHint, disabled: !dirty },
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
}> = ({ step, onIconSubmit, onIconPick, onBack }) => {
  const [entryMode, setEntryMode] = React.useState(false)
  const currentIcon = readIdentityStateString(step.identity.state, 'imageUrl')
  const draft = step.imagePath

  if (entryMode) {
    return (
      <Surface title="Edit Icon" subtitle="Paste an https or ipfs URL, or the path to an image on this machine." footer={footerHint('↵ save · esc back')}>
        <TextInput
          key="edit-profile-icon-entry"
          placeholder="https or ipfs URL, or a file path"
          validate={validateAgentIconReference}
          onSubmit={value => onIconSubmit(value.trim())}
          onCancel={() => setEntryMode(false)}
        />
      </Surface>
    )
  }

  type IconAction = 'choose' | 'enter' | 'remove' | 'undo' | 'back'
  const options: Array<{ value: IconAction; label: string; hint?: string; role?: 'utility' }> = [
    { value: 'choose', label: 'Choose a File', hint: 'Opens the file picker' },
    { value: 'enter', label: 'Enter a URL or Path' },
  ]
  if (currentIcon && draft !== 'delete') options.push({ value: 'remove', label: 'Remove Icon' })
  if (draft !== undefined) options.push({ value: 'undo', label: 'Undo Change', hint: currentIcon ? 'Keep the published icon' : 'Keep no icon' })
  options.push({ value: 'back', label: 'Back', role: 'utility' })

  return (
    <Surface title="Edit Icon" subtitle={iconStatusLine(draft, currentIcon)} footer={footerHint('↵ select · esc back')}>
      {step.error ? <Box marginBottom={1}><Paragraph color={theme.accentError}>{step.error}</Paragraph></Box> : null}
      <Select<IconAction>
        options={options}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'choose') return onIconPick()
          if (choice === 'enter') { setEntryMode(true); return }
          if (choice === 'remove') return onIconSubmit('delete')
          if (choice === 'undo') return onIconSubmit(undefined)
          return onBack()
        }}
        onCancel={onBack}
      />
    </Surface>
  )
}

function iconStatusLine(draft: string | undefined, currentIcon: string): string {
  if (draft === 'delete') return 'Publishing removes the current icon.'
  if (draft) return `New icon: ${iconFileName(draft)}. Publish to apply it.`
  return currentIcon ? `Published icon: ${iconFileName(currentIcon)}` : 'No icon yet.'
}

const EditProfileReviewStep: React.FC<{
  step: Extract<Step, { kind: 'edit-profile-review' }>
  onSave: () => void
  onBack: () => void
}> = ({ step, onSave, onBack }) => {
  const savedName = readIdentityStateString(step.identity.state, 'name')
  const savedDescription = readIdentityStateString(step.identity.state, 'description')
  const savedIcon = readIdentityStateString(step.identity.state, 'imageUrl')
  return (
    <Surface title="Publish Profile?" subtitle="Your wallet approves publishing it onchain. A snapshot of your soul, memory, and skills is saved with it." footer={footerHint('↵ select · esc back')}>
      <FieldList fields={[
        { label: 'Name', value: step.name || 'Not set', ...(step.name === savedName ? { valueColor: theme.dim } : {}) },
        { label: 'Description', value: step.description || 'Not set', ...(step.description === savedDescription ? { valueColor: theme.dim } : {}) },
        { label: 'Icon', value: step.imagePath === 'delete' ? 'Removed' : step.imagePath ? shortIconReference(step.imagePath) : savedIcon ? shortIconReference(savedIcon) : 'None', ...(step.imagePath === undefined ? { valueColor: theme.dim } : {}) },
      ]} />
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
  if (imagePath === 'delete') return 'Removed'
  if (imagePath) return iconFileName(imagePath)
  return currentIcon ? iconFileName(currentIcon) : 'None'
}

function iconFileName(value: string): string {
  const trimmed = value.trim()
  const withoutQuery = trimmed.replace(/[?#].*$/, '')
  const name = withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed
  const base = /^[a-z][a-z0-9+.-]*:$/i.test(name) || name.length > 40 ? shortIconReference(trimmed) : name
  return base.length > 40 ? `${base.slice(0, 24)}…${base.slice(-15)}` : base
}

function shortIconReference(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 56) return trimmed
  const url = shortUrlReference(trimmed)
  if (url) return url
  return `${trimmed.slice(0, 24)}…${trimmed.slice(-20)}`
}

function shortUrlReference(value: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    const parts = url.pathname.split('/').filter(Boolean)
    const file = parts.at(-1)
    if (!file) return `${url.protocol}//${url.hostname}`
    return `${url.protocol}//${url.hostname}/…/${file}`
  } catch {
    if (!/^ipfs:\/\//i.test(value)) return null
    return `${value.slice(0, 22)}…${value.slice(-18)}`
  }
}

function previewText(value: string, width: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= width) return singleLine
  const cut = singleLine.slice(0, Math.max(8, width - 1))
  const space = cut.lastIndexOf(' ')
  return `${(space > 8 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`
}
