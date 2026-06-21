import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import {
  listSkillsTree,
  type SkillsTreeView,
} from '../../../continuity/skills/loadSkills.js'
import type { SkillIndexEntry } from '../../../continuity/skills/types.js'
import { IdentitySummary } from '../../shared/components/IdentitySummary.js'
import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'

type SkillsTreeAction =
  | { kind: 'skill'; relativePath: string }
  | { kind: 'open-folder' }
  | { kind: 'noop' }
  | { kind: 'back' }

interface SkillsTreeScreenProps {
  identity?: EthagentIdentity
  config?: EthagentConfig
  workingStatus?: ContinuityWorkingTreeStatus | null
  notice?: string
  editorOpened?: boolean
  initialTree?: SkillsTreeView
  footer: React.ReactNode
  onOpenSkill: (relativePath: string) => void
  onOpenFolder: () => void
  onBack: () => void
}

export const SkillsTreeScreen: React.FC<SkillsTreeScreenProps> = ({
  identity,
  config,
  workingStatus,
  notice,
  editorOpened,
  initialTree,
  footer,
  onOpenSkill,
  onOpenFolder,
  onBack,
}) => {
  const [tree, setTree] = useState<SkillsTreeView | null>(initialTree ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialTree) return
    let cancelled = false
    if (!identity) {
      setTree({ skills: [], supportingCounts: {} })
      return () => { cancelled = true }
    }
    const refresh = (): Promise<void> => listSkillsTree(identity)
      .then(view => {
        if (cancelled) return
        setTree(view)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        setTree({ skills: [], supportingCounts: {} })
        setError(String((err as Error).message ?? err))
      })
    void refresh()
    if (!editorOpened) return () => { cancelled = true }
    const interval = setInterval(() => { void refresh() }, 1500)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [identity, editorOpened, initialTree])

  const subtitle = notice ?? 'Public and private skills.'
  const isLoading = tree === null
  const skills = tree?.skills ?? []
  const supportingCounts = tree?.supportingCounts ?? {}
  const hasAny = skills.length > 0

  const options = buildOptions(skills, supportingCounts, isLoading, hasAny)

  return (
    <Surface title="Skills" subtitle={subtitle} footer={footer}>
      <IdentitySummary identity={identity} config={config} workingStatus={workingStatus} compact />
      {error && (
        <Box marginTop={1}>
          <Text color={theme.accentError}>{error}</Text>
        </Box>
      )}
      {editorOpened && (
        <Box marginTop={1}>
          <Text color={theme.accentPeriwinkle}>Save with ctrl+s in your editor</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Select<SkillsTreeAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice.kind === 'skill') return onOpenSkill(choice.relativePath)
            if (choice.kind === 'open-folder') return onOpenFolder()
            if (choice.kind === 'back') return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function buildOptions(
  entries: SkillIndexEntry[],
  supportingCounts: Record<string, number>,
  isLoading: boolean,
  hasAny: boolean,
): Array<SelectOption<SkillsTreeAction>> {
  const rows: Array<SelectOption<SkillsTreeAction>> = []
  const noopValue: SkillsTreeAction = { kind: 'noop' }

  if (isLoading) {
    rows.push({
      value: noopValue,
      role: 'notice',
      label: 'Loading...',
      labelColor: theme.dim,
      indent: 0,
    })
  } else if (!hasAny) {
    rows.push({ value: noopValue, role: 'notice', label: 'No skills yet.', labelColor: theme.dim })
  } else {
    rows.push({ value: noopValue, role: 'section', label: 'Catalog' })
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const skill of sorted) {
      if (!skill) continue
      const supportCount = supportingCounts[skill.name] ?? 0
      const meta = [capitalize(skill.visibility)]
      if (supportCount > 0) meta.push(`${supportCount + 1} files`)
      rows.push({
        value: { kind: 'skill', relativePath: skill.relativePath },
        label: skill.name,
        hint: meta.join('  ·  '),
      })
    }
    rows.push({ value: noopValue, role: 'section', label: '' })
  }

  rows.push({
    value: { kind: 'open-folder' },
    label: 'Open Skills Folder',
  })
  rows.push({
    value: { kind: 'back' },
    label: 'Back',
    role: 'utility',
  })

  return rows
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
