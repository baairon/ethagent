import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { Paragraph } from '../../../ui/Paragraph.js'
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
        {...(step.error ? { error: step.error } : {})}
        footer={<Text color={theme.dim}>↵ save · esc back</Text>}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    )
  }

  if (step.kind === 'storage-credential-forget-confirm') {
    return (
      <Surface
        title="Forget IPFS Storage?"
        subtitle="Removes the saved Pinata JWT from this machine. Snapshots already pinned stay on IPFS."
        footer={footer}
        tone="error"
      >
        <Select<StorageCredentialAction>
          options={[
            { value: 'forget', label: 'Forget JWT' },
            { value: 'back', label: 'Keep JWT', role: 'utility' },
          ]}
          initialIndex={1}
          hintLayout="inline"
          onSubmit={choice => choice === 'forget' ? onConfirmForget() : onCancel()}
          onCancel={onCancel}
        />
      </Surface>
    )
  }

  return (
    <Surface
      title="IPFS Storage"
      subtitle={hasCredential
        ? 'A Pinata JWT is saved, so this machine can pin encrypted snapshots.'
        : 'No Pinata JWT yet. Saving a snapshot asks for one.'}
      footer={footer}
    >
      {!hasCredential ? <Box marginBottom={1}><Paragraph color={theme.dim}>Get one at app.pinata.cloud/developers/api-keys.</Paragraph></Box> : null}
      <Select<StorageCredentialAction>
        options={[
          { value: 'edit', label: hasCredential ? 'Replace JWT' : 'Add JWT' },
          ...(hasCredential ? [{ value: 'forget' as const, label: 'Forget JWT' }] : []),
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
    </Surface>
  )
}
