import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { IdentityHubErrorView } from '../model/errors.js'
import type { Step } from '../identityHubReducer.js'

type ErrorScreenProps = {
  error: IdentityHubErrorView
  back: Step
  footer: React.ReactNode
  closeLabel?: string
  closeHint?: string
  onBack: (back: Step) => void
  onClose: () => void
}

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  error,
  back,
  footer,
  closeLabel = 'Close Identity Hub',
  closeHint = 'Return to chat without retrying',
  onBack,
  onClose,
}) => (
  <Surface title={error.title} tone="error" subtitle={error.detail} footer={footer}>
    {error.hint ? <Text color={theme.dim}>{error.hint}</Text> : null}
    <Select<'back' | 'close'>
      options={[
        { value: 'back', role: 'section', label: 'Recovery' },
        { value: 'back', label: 'Go Back', hint: 'Return to the previous identity step' },
        { value: 'close', role: 'section', label: 'Exit' },
        { value: 'close', label: closeLabel, hint: closeHint, role: 'utility' },
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
