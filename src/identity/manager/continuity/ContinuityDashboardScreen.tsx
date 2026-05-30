import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { IdentitySummary } from '../shared/components/IdentitySummary.js'
import { readIdentityStateString } from '../custody/state.js'
import { shortCid } from '../shared/model/format.js'

type PrivateAction = 'soul' | 'memory' | 'back'
type PublicAction = 'edit' | 'back'

interface CommonProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  ready: boolean
  notice?: string
  editorOpened?: boolean
  footer: React.ReactNode
  onBack: () => void
}

export const PrivateContinuityScreen: React.FC<CommonProps & {
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
}) => (
  <Surface title="Soul & Memory" subtitle={notice ?? (!ready ? 'Run Refetch Latest to recover files.' : 'Persona and memory files.')} footer={footer}>
    <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact />
    {editorOpened && (
      <Box marginTop={1}>
        <Text color={theme.accentPeriwinkle}>Save with ctrl+s in your editor</Text>
      </Box>
    )}
    <Box marginTop={1}>
      <Select<PrivateAction>
        options={[
          { value: 'soul', label: 'Edit Soul', disabled: !ready },
          { value: 'memory', label: 'Edit Memory', disabled: !ready },
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

export const PublicProfileScreen: React.FC<CommonProps & {
  onEditProfile: () => void
}> = ({ identity, config, workingStatus, notice, editorOpened, footer, onEditProfile, onBack }) => {
  return (
    <Surface title="Public Profile" subtitle={notice ?? 'Name, description, and icon.'} footer={footer}>
      <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact />
      {editorOpened && (
        <Box marginTop={1}>
          <Text color={theme.accentPeriwinkle}>Save with ctrl+s in your editor</Text>
        </Box>
      )}
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
}
