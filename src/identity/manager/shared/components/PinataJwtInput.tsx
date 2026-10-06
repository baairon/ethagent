import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { TextInput } from '../../../../ui/TextInput.js'
import { theme } from '../../../../ui/theme.js'
import { extractPinataJwt } from '../../../storage/ipfs.js'

const PINATA_API_KEYS_URL = 'app.pinata.cloud/developers/api-keys'

type PinataJwtInputProps = {
  inputKey: string
  title?: string
  subtitle?: React.ReactNode
  footer: React.ReactNode
  onSubmit: (input: string) => void
  onCancel: () => void
}

export const PinataJwtInput: React.FC<PinataJwtInputProps> = ({
  inputKey,
  title,
  subtitle,
  footer,
  onSubmit,
  onCancel,
}) => (
  <Surface
    title={title ?? 'Connect IPFS Storage'}
    subtitle={subtitle ?? 'Snapshots are pinned to IPFS through your own Pinata account.'}
    footer={footer}
  >
    <Text color={theme.dim}>Paste a Pinata JWT from <Text color={theme.accentPeriwinkle} underline>{PINATA_API_KEYS_URL}</Text></Text>
    <Text color={theme.dim}>It is saved encrypted on this device and only used for pinning.</Text>
    <Box marginTop={1}>
      <TextInput
        key={inputKey}
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
    </Box>
  </Surface>
)
