import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { IdentitySummary } from '../shared/components/IdentitySummary.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { localChangeItems } from './state.js'

type PrivateAction = 'soul' | 'memory' | 'back'
type PublicAction = 'edit' | 'back'

interface CommonProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  ready: boolean
  notice?: string
  editorOpened?: boolean
  footer: React.ReactNode
  onBack: () => void
}

const EditorNote: React.FC = () => (
  <Box marginTop={1}>
    <Text color={theme.accentPeriwinkle}>Opened in your editor. Save to apply.</Text>
  </Box>
)

export const PrivateContinuityScreen: React.FC<CommonProps & {
  workingStatus?: ContinuityWorkingTreeStatus | null
  onOpenSoul: () => void
  onOpenMemory: () => void
}> = ({
  identity,
  config,
  workingStatus,
  ready,
  notice,
  editorOpened,
  footer,
  onOpenSoul,
  onOpenMemory,
  onBack,
}) => {
  const edited = new Set(localChangeItems(workingStatus).filter(item => item.kind === 'file').map(item => item.name))
  const fileOption = (value: PrivateAction, label: string, hint: string, file: string) => ({
    value,
    label,
    hint: edited.has(file) ? 'Unsaved edits' : hint,
    disabled: !ready,
    ...(edited.has(file) ? { labelColor: theme.accentError, hintColor: theme.accentError } : {}),
  })
  return (
    <Surface
      title="Soul & Memory"
      subtitle={notice ?? (ready ? 'Who your agent is and what it knows.' : 'Missing here. Refetch Latest restores them.')}
      footer={footer}
    >
      <IdentitySummary identity={identity} config={config} />
      {editorOpened ? <EditorNote /> : null}
      <Box marginTop={1}>
        <Select<PrivateAction>
          options={[
            fileOption('soul', 'Edit Soul', 'Voice and boundaries', 'SOUL.md'),
            fileOption('memory', 'Edit Memory', 'Facts and preferences', 'MEMORY.md'),
            { value: 'back', label: 'Back', role: 'utility' },
          ]}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'soul') return onOpenSoul()
            if (choice === 'memory') return onOpenMemory()
            return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

export const PublicProfileScreen: React.FC<CommonProps & {
  onEditProfile: () => void
}> = ({ identity, config, notice, editorOpened, footer, onEditProfile, onBack }) => (
  <Surface title="Public Profile" subtitle={notice ?? 'What your Agent Card shows.'} footer={footer}>
    <IdentitySummary identity={identity} config={config} />
    {editorOpened ? <EditorNote /> : null}
    <Box marginTop={1}>
      <Select<PublicAction>
        options={[
          { value: 'edit', label: 'Edit Profile' },
          { value: 'back', label: 'Back', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'edit') return onEditProfile()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)
