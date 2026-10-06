import React from 'react'
import { PinataJwtInput } from '../shared/components/PinataJwtInput.js'
import type { Step } from '../reducer.js'

interface RebackupStorageScreenProps {
  step: Extract<Step, { kind: 'rebackup-storage' | 'public-profile-storage' }>
  footer: React.ReactNode
  title?: string
  subtitle?: string
  onSubmit: (input: string) => void
  onCancel: () => void
}

export const RebackupStorageScreen: React.FC<RebackupStorageScreenProps> = ({ step, footer, title, subtitle, onSubmit, onCancel }) => {
  const publicOnly = step.kind === 'public-profile-storage'
  return (
    <PinataJwtInput
      inputKey="rebackup-storage"
      title={title}
      subtitle={step.error ?? subtitle ?? (publicOnly
        ? 'Publishing your profile needs a Pinata JWT to pin it to IPFS.'
        : 'Saving needs a Pinata JWT to pin the encrypted snapshot to IPFS.')}
      footer={footer}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}
