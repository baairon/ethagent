import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { copyableIdentityFields } from '../identityHubModel.js'
import { IdentitySummary } from './IdentitySummary.js'

type DetailsAction =
  | 'edit'
  | 'rebackup'
  | 'copy'
  | 'storage-credential'
  | 'forget-local'

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
  onRebackup: () => void
  onStorageCredential: () => void
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
  onRebackup,
  onStorageCredential,
  onForgetLocalData,
  onBack,
}) => {
  const subtitle = copyPicker
    ? 'choose a saved agent value.'
    : copyNotice ?? 'edit profile · back up · copy values · IPFS storage · device'

  const copyable = copyableIdentityFields(identity)

  if (copyPicker) {
    return (
      <Surface title="copy agent values" subtitle={subtitle} footer={footer}>
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

  const credentialLabel = jwtSaved ? 'IPFS storage' : 'connect IPFS storage'
  const options: Array<{ value: DetailsAction; label: string; disabled?: boolean }> = [
    { value: 'edit', label: 'edit profile', disabled: !canEditProfile },
    { value: 'rebackup', label: 'back up', disabled: !canRebackup },
    { value: 'copy', label: 'copy values', disabled: copyable.length === 0 },
    { value: 'storage-credential', label: credentialLabel },
    { value: 'forget-local', label: 'remove from this device' },
  ]

  return (
    <Surface title="manage agent" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} />
      <Box marginTop={1}>
        <Select<DetailsAction>
          options={options}
          onSubmit={choice => {
            if (choice === 'edit') return onEditProfile()
            if (choice === 'copy') return onOpenCopyPicker()
            if (choice === 'rebackup') return onRebackup()
            if (choice === 'storage-credential') return onStorageCredential()
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
  return `${value.slice(0, 14)}…${value.slice(-10)}`
}
