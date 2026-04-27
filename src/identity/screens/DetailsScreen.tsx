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
  | 'export-snapshot'
  | 'import-snapshot'
  | 'copy'
  | 'storage-credential'
  | 'forget-local'
  | 'back'

type DetailsScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  copyPicker?: boolean
  jwtSaved: boolean
  copyNotice?: string | null
  canRebackup: boolean
  canEditProfile: boolean
  canExportSnapshot: boolean
  footer: React.ReactNode
  onCopy: (label: string, value: string) => void
  onOpenCopyPicker: () => void
  onCloseCopyPicker: () => void
  onEditProfile: () => void
  onRebackup: () => void
  onExportSnapshot: () => void
  onImportSnapshot: () => void
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
  canExportSnapshot,
  footer,
  onCopy,
  onOpenCopyPicker,
  onCloseCopyPicker,
  onEditProfile,
  onRebackup,
  onExportSnapshot,
  onImportSnapshot,
  onStorageCredential,
  onForgetLocalData,
  onBack,
}) => {
  const subtitle = copyPicker
    ? 'pick a value to copy.'
    : copyNotice ?? 'profile, technical values, storage, and local cleanup.'

  const copyable = copyableIdentityFields(identity)

  if (copyPicker) {
    return (
      <Surface title="agent settings" subtitle={subtitle} footer={footer}>
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

  const credentialLabel = jwtSaved ? 'IPFS credential' : 'add IPFS credential'
  const options: Array<{ value: DetailsAction; label: string; disabled?: boolean }> = [
    { value: 'edit', label: 'edit profile', disabled: !canEditProfile },
    { value: 'rebackup', label: 'back up', disabled: !canRebackup },
    { value: 'export-snapshot', label: 'export snapshot', disabled: !canExportSnapshot },
    { value: 'import-snapshot', label: 'import snapshot' },
    { value: 'copy', label: 'copy values', disabled: copyable.length === 0 },
    { value: 'storage-credential', label: credentialLabel },
    { value: 'forget-local', label: 'forget local agent' },
    { value: 'back', label: 'back to hub' },
  ]

  return (
    <Surface title="agent settings" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} />
      <Box marginTop={1}>
        <Select<DetailsAction>
          options={options}
          onSubmit={choice => {
            if (choice === 'edit') return onEditProfile()
            if (choice === 'copy') return onOpenCopyPicker()
            if (choice === 'rebackup') return onRebackup()
            if (choice === 'export-snapshot') return onExportSnapshot()
            if (choice === 'import-snapshot') return onImportSnapshot()
            if (choice === 'storage-credential') return onStorageCredential()
            if (choice === 'forget-local') return onForgetLocalData()
            return onBack()
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
