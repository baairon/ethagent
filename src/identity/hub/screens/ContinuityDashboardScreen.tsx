import React from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../ui/Surface.js'
import { Select } from '../../../ui/Select.js'
import { theme } from '../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../storage/config.js'
import { IdentitySummary } from './IdentitySummary.js'
import { shortCid } from '../identityHubModel.js'

type PrivateAction = 'soul' | 'memory' | 'backup' | 'back'
type PublicAction = 'edit' | 'skills' | 'publish' | 'back'

type CommonProps = {
  identity?: EthagentIdentity
  config?: EthagentConfig
  ready: boolean
  notice?: string
  footer: React.ReactNode
  onBack: () => void
}

export const PrivateContinuityScreen: React.FC<CommonProps & {
  canBackup: boolean
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
  onOpenSoul,
  onOpenMemory,
  onBackup,
  onBack,
}) => (
  <Surface title="Private Memory Files" subtitle={notice ?? privateSubtitle(ready)} footer={footer}>
    <IdentitySummary identity={identity} config={config} compact />
    <PrivateRows identity={identity} ready={ready} />
    <Box marginTop={1}>
      <Select<PrivateAction>
        options={[
          { value: 'soul', role: 'section', prefix: '--', label: 'Open local files' },
          { value: 'soul', label: 'open SOUL.md', hint: 'edit persona and operating preferences', disabled: !ready },
          { value: 'memory', label: 'open MEMORY.md', hint: 'edit private working memory for this agent', disabled: !ready },
          { value: 'backup', role: 'section', prefix: '--', label: 'Recovery' },
          { value: 'backup', label: 'publish snapshot now', hint: 'publishes SOUL.md, MEMORY.md, skills.json, and metadata', disabled: !ready || !canBackup },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to identity hub', hint: 'return without changing private files', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
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
  onEditProfile: () => void
  onOpenSkills: () => void
  onPublish: () => void
}> = ({ identity, config, notice, footer, canPublish, onEditProfile, onOpenSkills, onPublish, onBack }) => (
  <Surface title="Public Profile" subtitle={notice ?? 'Manage public metadata, skills.json, and the agent card.'} footer={footer}>
    <IdentitySummary identity={identity} config={config} compact />
    <PublicProfileRows identity={identity} />
    <Box marginTop={1}>
      <Select<PublicAction>
        options={[
          { value: 'edit', role: 'section', prefix: '--', label: 'Profile' },
          { value: 'edit', label: 'edit name, description, image', hint: 'upload a local image to IPFS automatically' },
          { value: 'skills', role: 'section', prefix: '--', label: 'Capabilities' },
          { value: 'skills', label: 'open skills.json', hint: 'edit public capabilities and notes' },
          { value: 'publish', role: 'section', prefix: '--', label: 'Recovery' },
          { value: 'publish', label: 'publish snapshot now', hint: 'publishes SOUL.md, MEMORY.md, skills.json, and metadata', disabled: !canPublish },
          { value: 'back', role: 'section', prefix: '--', label: 'Navigation' },
          { value: 'back', label: 'back to identity hub', hint: 'return without changing public metadata', role: 'utility' },
        ]}
        hintLayout="inline"
        onSubmit={choice => {
          if (choice === 'edit') return onEditProfile()
          if (choice === 'skills') return onOpenSkills()
          if (choice === 'publish') return onPublish()
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
      <Text color={identity?.publicSkills?.cid ? theme.text : theme.dim}>{identity?.publicSkills?.cid ? shortCid(identity.publicSkills.cid) : 'not published'}</Text>
    </Text>
    <Text>
      <Text color={theme.dim}>{'agent card'.padEnd(13)}</Text>
      <Text color={identity?.publicSkills?.agentCardCid ? theme.text : theme.dim}>{identity?.publicSkills?.agentCardCid ? shortCid(identity.publicSkills.agentCardCid) : 'not published'}</Text>
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
