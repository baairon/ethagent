import React from 'react'
import { Box } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select, type SelectOption } from '../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { copyableIdentityFields } from '../identityHubModel.js'
import { IdentitySummary } from './IdentitySummary.js'

type CopyAction = `copy:${string}` | 'back'

type DetailsScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  copyNotice?: string | null
  footer: React.ReactNode
  onCopy: (label: string, value: string) => void
  onBack: () => void
}

export const DetailsScreen: React.FC<DetailsScreenProps> = ({
  identity,
  config,
  copyNotice,
  footer,
  onCopy,
  onBack,
}) => {
  const copyable = copyableIdentityFields(identity)
  const options: Array<SelectOption<CopyAction>> = [
    ...(copyable.length > 0 ? [{ value: 'back' as const, role: 'section' as const, prefix: '--', label: 'Values' }] : []),
    ...copyable.map(field => ({
      value: `copy:${field.label}` as const,
      label: field.label,
      hint: shortPreview(field.value),
    })),
    ...(copyable.length === 0 ? [{ value: 'back' as const, role: 'notice' as const, label: 'no values available yet' }] : []),
    { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
    { value: 'back', label: 'back to identity hub', hint: 'return without copying', role: 'utility' },
  ]

  return (
    <Surface title="Copy Identity Values" subtitle={copyNotice ?? 'Choose one value to copy.'} footer={footer}>
      <IdentitySummary identity={identity} config={config} compact />
      <Box marginTop={1}>
        <Select<CopyAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'back') return onBack()
            const label = choice.slice('copy:'.length)
            const found = copyable.find(field => field.label === label)
            if (found) onCopy(found.label, found.value)
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function shortPreview(value: string): string {
  if (value.length <= 42) return value
  return `${value.slice(0, 18)}...${value.slice(-14)}`
}
