import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { IdentityManagerErrorView } from '../model/errors.js'
import type { Step } from '../../reducer.js'

type ErrorScreenProps = {
  error: IdentityManagerErrorView
  back: Step
  footer: React.ReactNode
  closeLabel?: string
  onBack: (back: Step) => void
  onClose: () => void
}

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  error,
  back,
  footer,
  closeLabel = 'Close',
  onBack,
  onClose,
}) => (
  <Surface title={error.title} tone="error" subtitle={error.detail} footer={footer}>
    {error.hint ? <Text color={theme.dim}>{error.hint}</Text> : null}
    <Select<'back' | 'close'>
      options={[
        { value: 'back', label: 'Back' },
        { value: 'close', label: closeLabel, role: 'utility' },
      ]}
      hintLayout="inline"
      onSubmit={choice => {
        if (choice === 'back') onBack(back)
        else onClose()
      }}
      onCancel={() => onBack(back)}
    />
  </Surface>
)
