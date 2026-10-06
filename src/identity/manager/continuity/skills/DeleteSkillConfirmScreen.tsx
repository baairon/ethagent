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

const MAX_LISTED_FILES = 8

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

  const skillMissing = entries !== null && !entries.some(entry => entry.relativePath === target.relativePath)
  const subtitle = skillMissing
    ? 'This skill was already removed. Go back to refresh the list.'
    : 'Removes it from your vault and every connected tool. Saved snapshots keep their copy.'

  return (
    <Surface title={`Delete ${skillName}?`} subtitle={subtitle} footer={footer} tone="error">
      {skillMissing ? null : (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.text}>{`skills/${skillName}/`}</Text>
          {files === null
            ? <Text color={theme.dim}>  Reading the folder…</Text>
            : <FolderContents files={files} />}
        </Box>
      )}
      <Select<ConfirmChoice>
        options={[
          { value: 'delete', label: 'Delete Skill', bold: true, disabled: skillMissing },
          { value: 'cancel', label: 'Keep Skill', role: 'utility' },
        ]}
        hintLayout="inline"
        initialIndex={1}
        onSubmit={choice => {
          if (choice === 'delete') return onConfirm()
          return onCancel()
        }}
        onCancel={onCancel}
      />
    </Surface>
  )
}

const FolderContents: React.FC<{ files: SkillFileEntry[] }> = ({ files }) => {
  if (files.length === 0) return <Text color={theme.dim}>  Empty folder</Text>
  const shown = files.slice(0, MAX_LISTED_FILES)
  const extra = files.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map(f => (
        <Text key={f.relativePath} color={theme.textSubtle}>{`  ${f.relativePath}`}</Text>
      ))}
      {extra > 0 ? <Text color={theme.dim}>{`  +${extra} more`}</Text> : null}
    </Box>
  )
}
