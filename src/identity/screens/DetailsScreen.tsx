import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { copyableIdentityFields } from '../identityHubModel.js'
import { IdentitySummary } from './IdentitySummary.js'

type DetailsAction =
  | 'edit'
  | 'continuity'
  | 'rebackup'
  | 'copy'
  | 'storage-credential'
  | 'data-management'
  | 'forget-local'

type DetailsOption =
  | DetailsAction
  | 'profile-section'
  | 'backup-section'
  | 'values-section'
  | 'storage-section'
  | 'device-section'

type DetailsScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  copyPicker?: boolean
  jwtSaved: boolean
  copyNotice?: string | null
  canRebackup: boolean
  canEditProfile: boolean
  footer: React.ReactNode
  onCopy: (label: string, value: string) => void
  onOpenCopyPicker: () => void
  onCloseCopyPicker: () => void
  onEditProfile: () => void
  onContinuity: () => void
  onRebackup: () => void
  onStorageCredential: () => void
  onDataManagement: () => void
  onForgetLocalData: () => void
  onBack: () => void
}

export const DetailsScreen: React.FC<DetailsScreenProps> = ({
  identity,
  config,
  copyPicker,
  jwtSaved,
  copyNotice,
  canRebackup,
  canEditProfile,
  footer,
  onCopy,
  onOpenCopyPicker,
  onCloseCopyPicker,
  onEditProfile,
  onContinuity,
  onRebackup,
  onStorageCredential,
  onDataManagement,
  onForgetLocalData,
  onBack,
}) => {
  const subtitle = copyPicker
    ? 'choose a saved agent value.'
    : copyNotice ?? 'profile, memory, publishing, values, storage, device'

  const copyable = copyableIdentityFields(identity)

  if (copyPicker) {
    return (
      <Surface title="Copy Agent Values" subtitle={subtitle} footer={footer}>
        <IdentitySummary identity={identity} config={config} />
        <Box marginTop={1}>
          <Select<string>
            options={copyable.map(field => ({ value: field.label, label: field.label, hint: shortPreview(field.value) }))}
            onSubmit={label => {
              const found = copyable.find(field => field.label === label)
              if (found) onCopy(found.label, found.value)
            }}
            onCancel={onCloseCopyPicker}
          />
        </Box>
      </Surface>
    )
  }

  const credentialLabel = jwtSaved ? 'pinning credential' : 'connect pinning'
  const options: Array<SelectOption<DetailsOption>> = [
    section('profile-section', 'Agent Profile'),
    { value: 'edit', label: 'name and description', disabled: !canEditProfile, indent: 2 },
    { value: 'continuity', label: 'memory, persona, skills', disabled: !identity, indent: 2 },
    section('backup-section', 'Publishing'),
    { value: 'rebackup', label: 'save snapshot and publish', disabled: !canRebackup, hint: 'encrypted private files plus public discovery', indent: 2 },
    section('values-section', 'Copy Values'),
    { value: 'copy', label: 'copy saved values', disabled: copyable.length === 0, indent: 2 },
    section('storage-section', 'IPFS Storage'),
    { value: 'storage-credential', label: credentialLabel, indent: 2 },
    section('device-section', 'Device'),
    { value: 'data-management', label: 'local data and reset', hint: 'what is stored and what reset wipes', indent: 2 },
    { value: 'forget-local', label: 'unlink active agent', hint: 'keeps markdown, chats, token, and pinned backups', indent: 2 },
  ]

  return (
    <Surface title="Agent Settings" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} />
      <Box marginTop={1}>
        <Select<DetailsOption>
          options={options}
          onSubmit={choice => {
            if (choice === 'edit') return onEditProfile()
            if (choice === 'continuity') return onContinuity()
            if (choice === 'copy') return onOpenCopyPicker()
            if (choice === 'rebackup') return onRebackup()
            if (choice === 'storage-credential') return onStorageCredential()
            if (choice === 'data-management') return onDataManagement()
            if (choice === 'forget-local') return onForgetLocalData()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function shortPreview(value: string): string {
  if (value.length <= 28) return value
  return `${value.slice(0, 14)}...${value.slice(-10)}`
}

function section(value: Extract<DetailsOption, `${string}-section`>, label: string): SelectOption<DetailsOption> {
  return {
    value,
    label,
    disabled: true,
    role: 'section',
    bold: true,
  }
}
