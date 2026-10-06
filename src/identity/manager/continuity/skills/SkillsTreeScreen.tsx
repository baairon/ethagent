import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { Paragraph } from '../../../../ui/Paragraph.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentConfig, EthagentIdentity } from '../../../../storage/config.js'
import {
  listSkillsTree,
  type SkillsTreeView,
} from '../../../continuity/skills/loadSkills.js'
import type { SkillIndexEntry } from '../../../continuity/skills/types.js'
import { IdentitySummary } from '../../shared/components/IdentitySummary.js'
import type { ContinuityWorkingTreeStatus } from '../../../continuity/storage.js'
import { localChangeItems, type LocalChangeItem } from '../state.js'

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

  const changed = new Map(
    localChangeItems(workingStatus)
      .filter(item => item.kind === 'skill')
      .map(item => [item.name, item] as const),
  )
  const options = buildOptions(tree, changed)

  return (
    <Surface title="Skills" subtitle={notice ?? 'Public ones show on your Agent Card.'} footer={footer}>
      <IdentitySummary identity={identity} config={config} />
      {error ? (
        <Box marginTop={1}>
          <Paragraph color={theme.accentError}>{error}</Paragraph>
        </Box>
      ) : null}
      {editorOpened ? (
        <Box marginTop={1}>
          <Text color={theme.accentPeriwinkle}>Opened in your editor. Save to apply.</Text>
        </Box>
      ) : null}
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
  tree: SkillsTreeView | null,
  changed: Map<string, LocalChangeItem>,
): Array<SelectOption<SkillsTreeAction>> {
  const rows: Array<SelectOption<SkillsTreeAction>> = []
  const noopValue: SkillsTreeAction = { kind: 'noop' }

  if (tree === null) {
    rows.push({ value: noopValue, role: 'notice', label: 'Loading skills…', labelColor: theme.dim })
  } else if (tree.skills.length === 0) {
    rows.push({ value: noopValue, role: 'notice', label: 'No skills yet. Add a folder with a SKILL.md to the skills folder.', labelColor: theme.dim })
  } else {
    const sorted = [...tree.skills].sort((a, b) => a.name.localeCompare(b.name))
    for (const visibility of ['public', 'private'] as const) {
      const group = sorted.filter(skill => skill.visibility === visibility)
      if (group.length === 0) continue
      rows.push({ value: noopValue, role: 'section', label: visibility === 'public' ? 'Public' : 'Private' })
      for (const skill of group) rows.push(skillOption(skill, tree.supportingCounts[skill.name] ?? 0, changed.get(skill.name)))
    }
    rows.push({ value: noopValue, role: 'section', label: '' })
  }

  rows.push({ value: { kind: 'open-folder' }, label: 'Open Skills Folder' })
  rows.push({ value: { kind: 'back' }, label: 'Back', role: 'utility' })
  return rows
}

function skillOption(skill: SkillIndexEntry, supportCount: number, change: LocalChangeItem | undefined): SelectOption<SkillsTreeAction> {
  const meta = [supportCount > 0 ? `${supportCount + 1} files` : '1 file']
  if (change) meta.push('unsaved')
  return {
    value: { kind: 'skill', relativePath: skill.relativePath },
    label: skill.name,
    hint: meta.join(' · '),
    ...(change ? { labelColor: theme.accentError, hintColor: theme.accentError } : {}),
  }
}

