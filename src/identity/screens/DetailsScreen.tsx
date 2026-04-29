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
    { value: 'edit', label: 'profile', disabled: !canEditProfile },
    { value: 'continuity', label: 'memory and persona', disabled: !identity },
    { value: 'snapshots', label: 'snapshots', disabled: !identity },
    { value: 'storage-credential', label: credentialLabel },
    { value: 'copy', label: 'copy values', disabled: copyable.length === 0 },
    { value: 'data-management', label: 'local data' },
  ]

  return (
    <Surface title="agent settings" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} compact />
      <Box marginTop={1}>
        <Select<DetailsAction>
          options={options}
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
