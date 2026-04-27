import React from 'react'
import { Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { IdentityHubErrorView } from '../identityHubModel.js'
import type { Step } from '../identityHubReducer.js'

type ErrorScreenProps = {
  error: IdentityHubErrorView
  back: Step
  footer: React.ReactNode
  onBack: (back: Step) => void
  onClose: () => void
}

export const ErrorScreen: React.FC<ErrorScreenProps> = ({ error, back, footer, onBack, onClose }) => (
  <Surface title={error.title} tone="error" subtitle={error.detail} footer={footer}>
    {error.hint ? <Text color={theme.dim}>{error.hint}</Text> : null}
    <Select<'back' | 'close'>
      options={[
        { value: 'back', label: 'go back' },
        { value: 'close', label: 'close hub' },
      ]}
      onSubmit={choice => {
        if (choice === 'back') onBack(back)
        else onClose()
      }}
      onCancel={() => onBack(back)}
    />
  </Surface>
)
