import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { IdentitySummary } from '../shared/components/IdentitySummary.js'
import { changedContinuitySnapshotFiles } from './state.js'
import { readIdentityStateString } from '../custody/state.js'
import { shortCid } from '../shared/model/format.js'

type PrivateAction = 'soul' | 'memory' | 'skills' | 'export-backup' | 'back'
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

const SaveFromHubHint: React.FC<{ workingStatus?: ContinuityWorkingTreeStatus | null }> = ({ workingStatus }) => {
  const needsBackup = workingStatus?.publishState === 'local-changes'
    || workingStatus?.publishState === 'not-published'
    || workingStatus?.publishState === 'verify-needed'
  if (!needsBackup) return null
  const files = changedContinuitySnapshotFiles(workingStatus)
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={theme.accentError} bold>
        Unsaved changes
        {files.length > 0 ? `: ${files.join(', ')}` : ''}
      </Text>
      <Text color={theme.dim}>Use Save Snapshot Now in the Identity Hub menu, or relaunch ethagent.</Text>
    </Box>
  )
}

export const PrivateContinuityScreen: React.FC<CommonProps & {
  onOpenSoul: () => void
  onOpenMemory: () => void
  onOpenSkills: () => void
  onExportBackup: () => void
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
  onOpenSkills,
  onExportBackup,
  onBack,
}) => (
  <Surface title="Soul, Memory, and Skills" subtitle={notice ?? privateSubtitle(ready)} footer={footer}>
    <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} hideLocalChanges />
    <PrivateRows identity={identity} ready={ready} />
    <SaveFromHubHint workingStatus={workingStatus} />
    {editorOpened && (
      <Box marginTop={1}>
        <Text color={theme.accentPeriwinkle}>Save with ctrl+s in your editor</Text>
      </Box>
    )}
    <Box marginTop={1}>
      <Select<PrivateAction>
        options={[
          { value: 'soul', role: 'section', label: 'Private Continuity' },
          { value: 'soul', label: 'Edit Soul', hint: 'Voice, behavior, and operating preferences', disabled: !ready },
          { value: 'memory', label: 'Edit Memory', hint: 'Durable owner memory for this agent', disabled: !ready },
          { value: 'skills', role: 'section', label: 'Public Capabilities' },
          { value: 'skills', label: 'Edit skills.json', hint: 'Machine-readable capabilities for discovery', disabled: !ready },
          { value: 'export-backup', role: 'section', label: 'Local Backup' },
          { value: 'export-backup', label: 'Save Local Backup', hint: 'Bundle SOUL.md, MEMORY.md, skills.json into a zip you can keep anywhere', disabled: !ready },
          { value: 'back', role: 'section', label: 'Navigation' },
          { value: 'back', label: 'Back', hint: 'Return to Identity Hub menu', role: 'utility' },
        ]}
        hintLayout="inline"
          onSubmit={choice => {
            if (choice === 'soul') return onOpenSoul()
            if (choice === 'memory') return onOpenMemory()
            if (choice === 'skills') return onOpenSkills()
            if (choice === 'export-backup') return onExportBackup()
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
    <Surface title="Public Profile" subtitle={notice ?? 'Manage the public name, description, icon, and Agent Card.'} footer={footer}>
      <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} hideLocalChanges />
      <PublicProfileRows identity={identity} />
      <SaveFromHubHint workingStatus={workingStatus} />
      {editorOpened && (
        <Box marginTop={1}>
          <Text color={theme.accentPeriwinkle}>Save with ctrl+s in your editor</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Select<PublicAction>
          options={[
            { value: 'edit', role: 'section', label: 'Profile' },
            { value: 'edit', label: 'Edit Name, Description, Icon', hint: 'Update public profile fields used in the Agent Card' },
            { value: 'back', role: 'section', label: 'Navigation' },
            { value: 'back', label: 'Back', hint: 'Return to Identity Hub menu', role: 'utility' },
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

const PrivateRows: React.FC<{ identity?: EthagentIdentity; ready: boolean }> = ({ identity, ready }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{'Private'.padEnd(13)}</Text>
      <Text color={ready ? theme.text : theme.dim}>{ready ? 'Local Files Ready' : 'Missing Local Working Files'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'Snapshot'.padEnd(13)}</Text>
      <Text color={identity?.backup?.cid ? theme.text : theme.dim}>{identity?.backup?.cid ? shortCid(identity.backup.cid) : 'Not Saved Yet'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'Skills'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.cid ? theme.text : theme.dim}>{identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'Not Saved'}</Text>
    </Text>
  </Box>
)

const PublicProfileRows: React.FC<{ identity?: EthagentIdentity }> = ({ identity }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{publicProfileLabel('Agent Card')}</Text>
      <Text color={identity?.publicSkills?.agentCardCid ? theme.text : theme.dim}>{identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'Not Saved'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{publicProfileLabel('Agent Icon')}</Text>
      <Text color={readIdentityStateString(identity?.state, 'imageUrl') ? theme.text : theme.dim}>{readIdentityStateString(identity?.state, 'imageUrl') ? 'Attached' : 'Not Attached'}</Text>
    </Text>
  </Box>
)

function publicProfileLabel(label: string): string {
  return label.padEnd(16)
}

function privateSubtitle(ready: boolean): string {
  return ready
    ? 'Edit local continuity files. Public skills are saved with the same snapshot.'
    : 'Use "Refetch Latest Snapshot" from the Identity Hub menu to recover files.'
}
