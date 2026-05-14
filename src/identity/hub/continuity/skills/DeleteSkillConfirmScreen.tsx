import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentIdentity } from '../../../../storage/config.js'
import {
  listSkills,
  listSkillFiles,
  type SkillFileEntry,
} from '../../../continuity/skills/loadSkills.js'
import { continuityVaultRef } from '../../../continuity/storage.js'
import type { SkillIndexEntry } from '../../../continuity/skills/types.js'

type ConfirmChoice = 'delete' | 'cancel'

type DeleteTarget = { kind: 'skill'; relativePath: string }

interface DeleteSkillConfirmScreenProps {
  identity?: EthagentIdentity
  target: DeleteTarget
  footer: React.ReactNode
  onConfirm: () => void
  onCancel: () => void
}

const MAX_LISTED_FILES = 10

export const DeleteSkillConfirmScreen: React.FC<DeleteSkillConfirmScreenProps> = ({
  identity,
  target,
  footer,
  onConfirm,
  onCancel,
}) => {
  const [entries, setEntries] = useState<SkillIndexEntry[] | null>(null)
  const [files, setFiles] = useState<SkillFileEntry[] | null>(null)
  const skillName = target.relativePath.split('/')[0] ?? ''

  useEffect(() => {
    let cancelled = false
    if (!identity) { setEntries([]); setFiles([]); return () => { cancelled = true } }
    setEntries(null)
    setFiles(null)
    listSkills(identity)
      .then(result => { if (!cancelled) setEntries(result) })
      .catch(() => { if (!cancelled) setEntries([]) })
    listSkillFiles(identity, skillName)
      .then(result => { if (!cancelled) setFiles(result) })
      .catch(() => { if (!cancelled) setFiles([]) })
    return () => { cancelled = true }
  }, [identity, target.relativePath, skillName])

  const ref = identity ? continuityVaultRef(identity) : undefined
  const skillMissing = entries !== null && !entries.some(entry => entry.relativePath === target.relativePath)
  const supportingCount = (files ?? []).filter(f => f.relativePath !== 'SKILL.md').length
  const subtitle = skillMissing
    ? `Skill ${skillName} was already removed elsewhere. Cancel and refresh.`
    : supportingCount > 0
      ? `Removes ${skillName}/ and ${supportingCount} supporting file${supportingCount === 1 ? '' : 's'}. This cannot be undone.`
      : `Removes ${skillName}/. This cannot be undone.`

  return (
    <Surface title={`Delete ${skillName}?`} subtitle={subtitle} footer={footer} tone="error">
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim}>This will remove:</Text>
        {ref && (
          <Box marginLeft={2} flexDirection="column">
            <Text color={theme.text}>{ref.skillsDir}/{skillName}/</Text>
            {files === null ? (
              <Text color={theme.dim}>(loading folder contents...)</Text>
            ) : (
              <FolderContents files={files} />
            )}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Select<ConfirmChoice>
          options={[
            { value: 'delete', label: 'Yes, delete', hint: skillMissing ? 'Skill already missing on disk' : 'Permanent. Will be reflected in the next snapshot.', bold: true, disabled: skillMissing },
            { value: 'cancel', label: 'No, back', hint: 'Return to the delete picker', role: 'utility' },
          ]}
          hintLayout="inline"
          initialIndex={1}
          onSubmit={choice => {
            if (choice === 'delete') return onConfirm()
            return onCancel()
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}

const FolderContents: React.FC<{ files: SkillFileEntry[] }> = ({ files }) => {
  if (files.length === 0) {
    return <Text color={theme.dim}>(empty folder)</Text>
  }
  const shown = files.slice(0, MAX_LISTED_FILES)
  const extra = files.length - shown.length
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.dim}>Files to be removed:</Text>
      {shown.map(f => (
        <Text key={f.relativePath} color={theme.text}>  · {f.relativePath}</Text>
      ))}
      {extra > 0 && <Text color={theme.dim}>  · ...and {extra} more</Text>}
    </Box>
  )
}
