import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import { PinataJwtInput } from '../../components/PinataJwtInput.js'
import type { Step } from '../../identityHubReducer.js'

type StorageCredentialAction = 'edit' | 'forget' | 'back'

export const STORAGE_CREDENTIAL_FORGET_COPY = [
  'removes the saved IPFS storage token from this machine.',
  'existing pinned IPFS backups are not deleted.',
  'new encrypted snapshots cannot be pinned with that account until you save a token again.',
  'agent identity and sessions stay on this machine.',
] as const

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
        subtitle="This only removes the local token used for pinning."
        footer={footer}
      >
        <Box flexDirection="column">
          {STORAGE_CREDENTIAL_FORGET_COPY.map(line => (
            <Text key={line} color={theme.dim}>- {line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.accentPeriwinkle}>Remove the token from this machine?</Text>
        </Box>
        <Box marginTop={1}>
          <Select<StorageCredentialAction>
            options={[
              { value: 'forget', role: 'section', label: 'Credential' },
              { value: 'forget', label: 'Forget Credential', hint: 'Remove local IPFS pinning token' },
              { value: 'back', role: 'section', label: 'Navigation' },
              { value: 'back', label: 'Keep Credential', hint: 'Return without changing storage access', role: 'utility' },
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
      subtitle="Manage the credential used to pin encrypted snapshots from this machine."
      footer={footer}
    >
      <Box marginTop={1}>
        <Select<StorageCredentialAction>
          options={[
            { value: 'edit', role: 'section', label: 'Credential' },
            { value: 'edit', label: hasCredential ? 'Replace Credential' : 'Save Credential', hint: 'Store Pinata JWT for IPFS pinning' },
            { value: 'forget', label: 'Forget Credential', hint: 'Remove the local pinning token. Existing pins remain', disabled: !hasCredential },
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: 'Return to Identity Hub menu', role: 'utility' },
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
