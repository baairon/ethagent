import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
import { theme } from '../../../../ui/theme.js'
import type { IdentityManagerErrorView } from '../model/errors.js'
import type { Step } from '../../reducer.js'

type ErrorScreenProps = {
  error: IdentityManagerErrorView
  back: Step
  retry?: Step
  footer: React.ReactNode
  onBack: (back: Step) => void
  onRetry: (retry: Step) => void
}

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  error,
  back,
  retry,
  footer,
  onBack,
  onRetry,
}) => (
  <Surface title={error.title} tone="error" subtitle={error.detail} footer={footer}>
    {error.hint ? <Box marginBottom={1}><Paragraph color={theme.textSubtle}>{error.hint}</Paragraph></Box> : null}
    <Select<'retry' | 'back'>
      options={[
        ...(retry ? [{ value: 'retry' as const, label: 'Try Again' }] : []),
        { value: 'back', label: 'Back', ...(retry ? { role: 'utility' as const } : {}) },
      ]}
      hintLayout="inline"
      onSubmit={choice => {
        if (choice === 'retry' && retry) onRetry(retry)
        else onBack(back)
      }}
      onCancel={() => onBack(back)}
    />
  </Surface>
)
