import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { TextInput } from '../../../ui/TextInput.js'
import { theme } from '../../../ui/theme.js'
import { extractPinataJwt } from '../../storage/ipfs.js'
import type { Step } from '../identityHubReducer.js'

const PINATA_API_KEYS_URL = 'https://app.pinata.cloud/developers/api-keys'

type StorageCredentialAction = 'edit' | 'forget' | 'back'

export const STORAGE_CREDENTIAL_FORGET_COPY = [
  'removes the saved IPFS storage token from this machine.',
  'existing pinned IPFS backups are not deleted.',
  'ethagent cannot pin new encrypted state with that account until you save a token again.',
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
      <Surface
        title="IPFS Storage Credential"
        subtitle={step.error ?? 'Save the token ethagent uses to pin encrypted state.'}
        footer={footer}
      >
        <Text>
          <Text color={theme.dim}>Paste your Pinata JWT. Get one at </Text>
          <Text color={theme.accentPrimary} underline>{PINATA_API_KEYS_URL}</Text>
        </Text>
        <Text color={theme.dim}>Stored encrypted on this device. Used only for IPFS pinning.</Text>
        <TextInput
          key="storage-credential-input"
          isSecret
          placeholder="Pinata JWT"
          validate={v => {
            try {
              extractPinataJwt(v)
              return null
            } catch (err: unknown) {
              return (err as Error).message
            }
          }}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      </Surface>
    )
  }

  if (step.kind === 'storage-credential-forget-confirm') {
    return (
      <Surface
        title="Forget IPFS Storage Credential?"
        subtitle="This only removes the local token used for pinning."
        footer={footer}
      >
        <Box flexDirection="column">
          {STORAGE_CREDENTIAL_FORGET_COPY.map(line => (
            <Text key={line} color={theme.dim}>- {line}</Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={theme.accentPeach}>Remove the token from this machine?</Text>
        </Box>
        <Box marginTop={1}>
          <Select<StorageCredentialAction>
            options={[
              { value: 'forget', role: 'section', prefix: '--', label: 'Credential' },
              { value: 'forget', label: 'Forget Credential', hint: 'Remove local IPFS pinning token' },
              { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
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
      title="IPFS Storage Credential"
      subtitle="Controls whether ethagent can pin encrypted state from this machine."
      footer={footer}
    >
      <Box marginTop={1}>
        <Select<StorageCredentialAction>
          options={[
            { value: 'edit', role: 'section', prefix: '--', label: 'Credential' },
            { value: 'edit', label: hasCredential ? 'Replace Credential' : 'Save Credential', hint: 'Store Pinata JWT for IPFS pinning' },
            { value: 'forget', label: 'Forget Credential', hint: 'Remove the local pinning token; existing pins remain', disabled: !hasCredential },
            { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
            { value: 'back', label: 'Back To Identity Hub', hint: 'Return without changing storage access', role: 'utility' },
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
