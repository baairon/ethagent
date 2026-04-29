import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'
import { shortCid } from '../identityHubModel.js'

type DashboardAction = 'private' | 'public' | 'snapshots' | 'back'
type PrivateAction = 'restore' | 'soul' | 'memory' | 'backup' | 'back'
type PublicAction = 'skills' | 'publish' | 'back'

type CommonProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  ready: boolean
  notice?: string
  footer: React.ReactNode
  onBack: () => void
}

export const ContinuityDashboardScreen: React.FC<CommonProps & {
  onPrivate: () => void
  onPublic: () => void
  onSnapshots: () => void
}> = ({ identity, config, ready, notice, footer, onPrivate, onPublic, onSnapshots, onBack }) => (
  <Surface title="Memory & Persona" subtitle={notice ?? continuitySubtitle(identity, ready)} footer={footer}>
    <IdentitySummary identity={identity} config={config} />
    <ContinuityRows identity={identity} ready={ready} />
    <Box marginTop={1}>
      <Select<DashboardAction>
        options={[
          { value: 'private', label: 'private memory files', hint: 'restore, inspect, and back up SOUL.md and MEMORY.md' },
          { value: 'public', label: 'public discovery', hint: 'inspect SKILLS.md and publish agent-readable metadata' },
          { value: 'snapshots', label: 'snapshots', hint: 'status, history, and restore points' },
          { value: 'back', label: 'back' },
        ]}
        onSubmit={choice => {
          if (choice === 'private') return onPrivate()
          if (choice === 'public') return onPublic()
          if (choice === 'snapshots') return onSnapshots()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

export const PrivateContinuityScreen: React.FC<CommonProps & {
  canBackup: boolean
  onRestore: () => void
  onOpenSoul: () => void
  onOpenMemory: () => void
  onBackup: () => void
}> = ({
  identity,
  config,
  ready,
  notice,
  footer,
  canBackup,
  onRestore,
  onOpenSoul,
  onOpenMemory,
  onBackup,
  onBack,
}) => (
  <Surface title="Private Memory Files" subtitle={notice ?? privateSubtitle(ready)} footer={footer}>
    <IdentitySummary identity={identity} config={config} />
    <ContinuityRows identity={identity} ready={ready} />
    <Box marginTop={1}>
      <Select<PrivateAction>
        options={[
          { value: 'restore', label: 'restore from encrypted snapshot', hint: 'requires the wallet that owns the snapshot' },
          { value: 'soul', label: 'open SOUL.md', disabled: !ready },
          { value: 'memory', label: 'open MEMORY.md', disabled: !ready },
          { value: 'backup', label: 'save encrypted snapshot', disabled: !ready || !canBackup },
          { value: 'back', label: 'back' },
        ]}
        onSubmit={choice => {
          if (choice === 'restore') return onRestore()
          if (choice === 'soul') return onOpenSoul()
          if (choice === 'memory') return onOpenMemory()
          if (choice === 'backup') return onBackup()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

export const PublicSkillsScreen: React.FC<CommonProps & {
  canPublish: boolean
  onOpenSkills: () => void
  onPublish: () => void
}> = ({ identity, config, ready, notice, footer, canPublish, onOpenSkills, onPublish, onBack }) => (
  <Surface title="Public Discovery" subtitle={notice ?? 'SKILLS.md is public agent-readable metadata; private files stay separate.'} footer={footer}>
    <IdentitySummary identity={identity} config={config} />
    <ContinuityRows identity={identity} ready={ready} />
    <Box marginTop={1}>
      <Select<PublicAction>
        options={[
          { value: 'skills', label: 'open SKILLS.md' },
          { value: 'publish', label: 'publish skills and agent card', disabled: !canPublish, hint: 'pins SKILLS.md and updates tokenURI during backup' },
          { value: 'back', label: 'back' },
        ]}
        onSubmit={choice => {
          if (choice === 'skills') return onOpenSkills()
          if (choice === 'publish') return onPublish()
          return onBack()
        }}
        onCancel={onBack}
      />
    </Box>
  </Surface>
)

const ContinuityRows: React.FC<{ identity?: EthagentIdentity; ready: boolean }> = ({ identity, ready }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text>
      <Text color={theme.dim}>{'files'.padEnd(8)}</Text>
      <Text color={ready ? theme.text : theme.dim}>{ready ? 'private files ready' : 'restore local working files'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'snapshot'.padEnd(8)}</Text>
      <Text color={identity?.backup?.cid ? theme.text : theme.dim}>{identity?.backup?.cid ? shortCid(identity.backup.cid) : 'not saved yet'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'skills'.padEnd(8)}</Text>
      <Text color={identity?.publicSkills?.cid ? theme.text : theme.dim}>{identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'not published'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'card'.padEnd(8)}</Text>
      <Text color={identity?.publicSkills?.agentCardCid ? theme.text : theme.dim}>{identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'not published'}</Text>
    </Text>
  </Box>
)

function continuitySubtitle(identity: EthagentIdentity | undefined, ready: boolean): string {
  if (!identity) return 'Create or load an agent first.'
  return ready
    ? 'Private memory and public discovery are local; publishing is explicit.'
    : 'Restore private continuity from the encrypted snapshot before inspecting SOUL.md and MEMORY.md.'
}

function privateSubtitle(ready: boolean): string {
  return ready
    ? 'SOUL.md and MEMORY.md are private local files on this machine.'
    : 'Restore requires the wallet that owns the encrypted snapshot.'
}
