import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { TextInput } from '../../ui/TextInput.js'
import { theme } from '../../ui/theme.js'
import { extractPinataJwt } from '../ipfs.js'
import type { Step } from '../identityHubReducer.js'

const PINATA_API_KEYS_URL = 'https://app.pinata.cloud/developers/api-keys'

type RebackupStorageScreenProps = {
  step: Extract<Step, { kind: 'rebackup-storage' }>
  footer: React.ReactNode
  onSubmit: (input: string) => void
  onCancel: () => void
}

export const RebackupStorageScreen: React.FC<RebackupStorageScreenProps> = ({ step, footer, onSubmit, onCancel }) => (
  <Surface
    title="Connect IPFS Storage"
    subtitle={step.error ?? 'Save a Pinata JWT so ethagent can pin encrypted state to IPFS.'}
    footer={footer}
  >
    <Text>
      <Text color={theme.dim}>Paste your Pinata JWT. Get one at </Text>
      <Text color={theme.accentPrimary} underline>{PINATA_API_KEYS_URL}</Text>
    </Text>
    <Text color={theme.dim}>Saved encrypted on this device · used only for IPFS pinning</Text>
    <TextInput
      key="rebackup-storage"
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
