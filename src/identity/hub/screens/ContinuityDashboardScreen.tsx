import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import type { ContinuityWorkingTreeStatus } from '../../continuity/storage.js'
import { IdentitySummary } from './IdentitySummary.js'
import { shortCid } from '../identityHubModel.js'

type PrivateAction = 'soul' | 'memory' | 'back'
type PublicAction = 'edit' | 'skills' | 'back'

type CommonProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  ready: boolean
  notice?: string
  footer: React.ReactNode
  onBack: () => void
}

const SaveFromHubHint: React.FC<{ workingStatus?: ContinuityWorkingTreeStatus | null }> = ({ workingStatus }) => {
  const needsBackup = workingStatus?.publishState === 'local-changes'
    || workingStatus?.publishState === 'not-published'
    || workingStatus?.publishState === 'verify-needed'
  if (!needsBackup) return null
  return (
    <Box marginTop={1}>
      <Text color={theme.accentPeach}>Save path: Identity Hub &gt; Save Snapshot Now &gt; Yes, Save Snapshot Now.</Text>
    </Box>
  )
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
  footer,
  onOpenSoul,
  onOpenMemory,
  onBack,
}) => (
  <Surface title="Private Memory Files" subtitle={notice ?? privateSubtitle(ready)} footer={footer}>
    <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact />
    <PrivateRows identity={identity} ready={ready} />
    <SaveFromHubHint workingStatus={workingStatus} />
    <Box marginTop={1}>
      <Select<PrivateAction>
        options={[
          { value: 'soul', role: 'section', prefix: '--', label: 'Open Local Files' },
          { value: 'soul', label: 'Open SOUL.md', hint: 'Edit persona and operating preferences', disabled: !ready },
          { value: 'memory', label: 'Open MEMORY.md', hint: 'Edit private working memory for this agent', disabled: !ready },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'Back To Identity Hub', hint: 'Return without changing private files', role: 'utility' },
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

export const PublicSkillsScreen: React.FC<CommonProps & {
  onEditProfile: () => void
  onOpenSkills: () => void
}> = ({ identity, config, workingStatus, notice, footer, onEditProfile, onOpenSkills, onBack }) => (
  <Surface title="Public Profile" subtitle={notice ?? 'Manage public metadata, skills.json, and the agent card.'} footer={footer}>
    <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact />
    <PublicProfileRows identity={identity} />
    <SaveFromHubHint workingStatus={workingStatus} />
    <Box marginTop={1}>
      <Select<PublicAction>
        options={[
          { value: 'edit', role: 'section', prefix: '--', label: 'Profile' },
          { value: 'edit', label: 'Edit Name, Description, Image', hint: 'Upload a local image to IPFS automatically' },
          { value: 'skills', role: 'section', prefix: '--', label: 'Capabilities' },
          { value: 'skills', label: 'Open skills.json', hint: 'Edit public capabilities and notes' },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'Back To Identity Hub', hint: 'Return without changing public metadata', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'edit') return onEditProfile()
          if (choice === 'skills') return onOpenSkills()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

const PrivateRows: React.FC<{ identity?: EthagentIdentity; ready: boolean }> = ({ identity, ready }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{'Local Files'.padEnd(13)}</Text>
      <Text color={ready ? theme.text : theme.dim}>{ready ? 'SOUL.md and MEMORY.md Ready' : 'Missing Local Working Files'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'Snapshot'.padEnd(13)}</Text>
      <Text color={identity?.backup?.cid ? theme.text : theme.dim}>{identity?.backup?.cid ? shortCid(identity.backup.cid) : 'Not Saved Yet'}</Text>
    </Text>
  </Box>
)

const PublicProfileRows: React.FC<{ identity?: EthagentIdentity }> = ({ identity }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{'skills.json'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.cid ? theme.text : theme.dim}>{identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'Not Saved'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'Agent Card'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.agentCardCid ? theme.text : theme.dim}>{identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'Not Saved'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'Image'.padEnd(13)}</Text>
      <Text color={readStateString(identity?.state, 'imageUrl') ? theme.text : theme.dim}>{readStateString(identity?.state, 'imageUrl') ? 'Attached' : 'Not Attached'}</Text>
    </Text>
  </Box>
)

function privateSubtitle(ready: boolean): string {
  return ready
    ? 'SOUL.md and MEMORY.md are private local files on this machine.'
    : 'Use "Refetch Latest Snapshot" from the Identity Hub menu to recover files.'
}

function readStateString(state: Record<string, unknown> | undefined, key: string): string {
  const value = state?.[key]
  return typeof value === 'string' ? value.trim() : ''
}
