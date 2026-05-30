import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import { PinataJwtInput } from '../shared/components/PinataJwtInput.js'
import type { Step } from '../reducer.js'

type StorageCredentialAction = 'edit' | 'forget' | 'back'

type StorageCredentialScreenProps = {
  step: Extract<Step, { kind: 'storage-credential' | 'storage-credential-input' | 'storage-credential-forget-confirm' }>
  hasCredential: boolean
  footer: React.ReactNode
  onEdit: () => void
  onForget: () => void
  onConfirmForget: () => void
  onSubmit: (input: string) => void
  onCancel: () => void
}

export const StorageCredentialScreen: React.FC<StorageCredentialScreenProps> = ({
  step,
  hasCredential,
  footer,
  onEdit,
  onForget,
  onConfirmForget,
  onSubmit,
  onCancel,
}) => {
  if (step.kind === 'storage-credential-input') {
    return (
      <PinataJwtInput
        inputKey="storage-credential-input"
        title="IPFS Storage"
        subtitle={step.error ?? 'Save the Pinata JWT used to pin encrypted snapshots.'}
        footer={footer}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )
  }

  if (step.kind === 'storage-credential-forget-confirm') {
    return (
      <Surface
        title="Forget IPFS Storage?"
        subtitle="Local token only. Pinned files are not deleted."
        footer={footer}
      >
        <Box flexDirection="column">
          <Text color={theme.dim}>Removes the saved pinning token from this machine.</Text>
          <Text color={theme.dim}>Existing IPFS backups and agent data are not affected.</Text>
        </Box>
        <Box marginTop={1}>
          <Select<StorageCredentialAction>
            options={[
              { value: 'forget', label: 'Forget Credential' },
              { value: 'back', label: 'Keep Credential', role: 'utility' },
            ]}
            hintLayout="inline"
            onSubmit={choice => choice === 'forget' ? onConfirmForget() : onCancel()}
            onCancel={onCancel}
          />
        </Box>
      </Surface>
    )
  }

  return (
    <Surface
      title="IPFS Storage"
      subtitle="Pin encrypted snapshots from this machine."
      footer={footer}
    >
      <Box marginTop={1}>
        <Select<StorageCredentialAction>
          options={[
            { value: 'edit', label: hasCredential ? 'Replace Credential' : 'Save Credential' },
            { value: 'forget', label: 'Forget Credential', disabled: !hasCredential },
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'edit') return onEdit()
            if (choice === 'forget') return onForget()
            return onCancel()
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}
