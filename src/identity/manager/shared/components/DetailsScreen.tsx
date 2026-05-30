import React from 'react'
import { Box, Text } from 'ink'
import { theme } from '../../../../ui/theme.js'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import { copyableIdentityFields } from '../model/copy.js'
import { IdentitySummary } from './IdentitySummary.js'
import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'

type CopyAction = `copy:${string}` | 'back'

type DetailsScreenProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  copyNotice?: string | null
  unlinked?: boolean
  onchainOwner?: string
  footer: React.ReactNode
  onCopy: (label: string, value: string) => void
  onBack: () => void
}

export const DetailsScreen: React.FC<DetailsScreenProps> = ({
  identity,
  config,
  workingStatus,
  copyNotice,
  unlinked,
  onchainOwner,
  footer,
  onCopy,
  onBack,
}) => {
  const copyable = copyableIdentityFields(identity, config)
  const options: Array<SelectOption<CopyAction>> = [
    ...copyable.map(field => ({
      value: `copy:${field.label}` as const,
      label: field.label,
      hint: shortPreview(field.value),
    })),
    ...(copyable.length === 0 ? [{ value: 'back' as const, role: 'notice' as const, label: 'No Values Available Yet' }] : []),
    { value: 'back', label: 'Back', role: 'utility' },
  ]

  return (
    <Surface title="Token Values" subtitle={unlinked ? 'Token unlinked; values kept for reference.' : undefined} footer={footer}>
      <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} onchainOwner={onchainOwner} />
      {copyNotice ? <Text color={theme.accentPeriwinkle} bold>{copyNotice}</Text> : null}
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
  if (value.length <= 22) return value
  return `${value.slice(0, 11)}...${value.slice(-8)}`
}
