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
      <Text color={theme.accentPeach}>save these changes from the identity hub menu (esc to go back).</Text>
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
          { value: 'soul', role: 'section', prefix: '--', label: 'Open local files' },
          { value: 'soul', label: 'open SOUL.md', hint: 'edit persona and operating preferences', disabled: !ready },
          { value: 'memory', label: 'open MEMORY.md', hint: 'edit private working memory for this agent', disabled: !ready },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to identity hub', hint: 'return without changing private files', role: 'utility' },
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
          { value: 'edit', label: 'edit name, description, image', hint: 'upload a local image to IPFS automatically' },
          { value: 'skills', role: 'section', prefix: '--', label: 'Capabilities' },
          { value: 'skills', label: 'open skills.json', hint: 'edit public capabilities and notes' },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to identity hub', hint: 'return without changing public metadata', role: 'utility' },
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
      <Text color={theme.dim}>{'local files'.padEnd(13)}</Text>
      <Text color={ready ? theme.text : theme.dim}>{ready ? 'SOUL.md and MEMORY.md ready' : 'missing local working files'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'snapshot'.padEnd(13)}</Text>
      <Text color={identity?.backup?.cid ? theme.text : theme.dim}>{identity?.backup?.cid ? shortCid(identity.backup.cid) : 'not saved yet'}</Text>
    </Text>
  </Box>
)

const PublicProfileRows: React.FC<{ identity?: EthagentIdentity }> = ({ identity }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{'skills.json'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.cid ? theme.text : theme.dim}>{identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'not saved'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'agent card'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.agentCardCid ? theme.text : theme.dim}>{identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'not saved'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'image'.padEnd(13)}</Text>
      <Text color={readStateString(identity?.state, 'imageUrl') ? theme.text : theme.dim}>{readStateString(identity?.state, 'imageUrl') ? 'attached' : 'not attached'}</Text>
    </Text>
  </Box>
)

function privateSubtitle(ready: boolean): string {
  return ready
    ? 'SOUL.md and MEMORY.md are private local files on this machine.'
    : 'Use "refetch latest snapshot" from the hub menu to recover files.'
}

function readStateString(state: Record<string, unknown> | undefined, key: string): string {
  const value = state?.[key]
  return typeof value === 'string' ? value.trim() : ''
}
