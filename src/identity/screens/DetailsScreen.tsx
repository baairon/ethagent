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
  | 'snapshots'
  | 'copy'
  | 'storage-credential'
  | 'data-management'

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
  onSnapshots: () => void
  onStorageCredential: () => void
  onDataManagement: () => void
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
  onSnapshots,
  onStorageCredential,
  onDataManagement,
  onBack,
}) => {
  const subtitle = copyPicker
    ? 'choose a value to copy.'
    : copyNotice ?? 'identity, continuity, storage'

  const copyable = copyableIdentityFields(identity)

  if (copyPicker) {
    return (
      <Surface title="copy values" subtitle={subtitle} footer={footer}>
        <IdentitySummary identity={identity} config={config} compact />
        <Box marginTop={1}>
          <Select<string>
            options={copyable.map(field => ({ value: field.label, label: field.label, hint: shortPreview(field.value) }))}
            hintLayout="inline"
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
  const options: Array<SelectOption<DetailsAction>> = [
    { value: 'edit', role: 'section', prefix: '--', label: 'Identity' },
    { value: 'edit', label: 'profile', hint: 'rename agent and public description', disabled: !canEditProfile },
    { value: 'copy', label: 'copy values', hint: 'copy CIDs, token id, URI, or owner', disabled: copyable.length === 0 },
    { value: 'continuity', role: 'section', prefix: '--', label: 'Continuity' },
    { value: 'continuity', label: 'memory and persona', hint: 'private files and public discovery', disabled: !identity },
    { value: 'snapshots', label: 'snapshots', hint: 'publish, review, restore checkpoints', disabled: !identity },
    { value: 'storage-credential', role: 'section', prefix: '--', label: 'Storage' },
    { value: 'storage-credential', label: credentialLabel, hint: 'save, replace, or forget pinning token' },
    { value: 'data-management', role: 'section', prefix: '--', label: 'Device' },
    { value: 'data-management', label: 'local data', hint: 'unlink and reset boundaries on this machine' },
  ]

  return (
    <Surface title="agent settings" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} compact />
      <Box marginTop={1}>
        <Select<DetailsAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'edit') return onEditProfile()
            if (choice === 'continuity') return onContinuity()
            if (choice === 'snapshots') return onSnapshots()
            if (choice === 'copy') return onOpenCopyPicker()
            if (choice === 'storage-credential') return onStorageCredential()
            if (choice === 'data-management') return onDataManagement()
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
