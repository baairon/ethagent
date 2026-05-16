import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentIdentity } from '../../../../storage/config.js'
import { listSkills, listSkillFiles } from '../../../continuity/skills/loadSkills.js'
import type { SkillIndexEntry, SkillVisibility } from '../../../continuity/skills/types.js'

type SkillAction =
  | { kind: 'open' }
  | { kind: 'set-visibility'; visibility: SkillVisibility }
  | { kind: 'delete' }
  | { kind: 'back' }
  | { kind: 'noop' }

interface SkillActionsScreenProps {
  identity?: EthagentIdentity
  relativePath: string
  notice?: string
  footer: React.ReactNode
  onOpenSkill: (relativePath: string) => void
  onSetVisibility: (relativePath: string, visibility: SkillVisibility) => void
  onDelete: (relativePath: string) => void
  onBack: () => void
}

export const SkillActionsScreen: React.FC<SkillActionsScreenProps> = ({
  identity,
  relativePath,
  notice,
  footer,
  onOpenSkill,
  onSetVisibility,
  onDelete,
  onBack,
}) => {
  const [entry, setEntry] = useState<SkillIndexEntry | null>(null)
  const [supportingCount, setSupportingCount] = useState<number | null>(null)
  const skillName = relativePath.split('/')[0] ?? ''

  useEffect(() => {
    let cancelled = false
    if (!identity) return () => { cancelled = true }
    listSkills(identity)
      .then(list => {
        if (cancelled) return
        const match = list.find(item => item.relativePath === relativePath)
        setEntry(match ?? null)
      })
      .catch(() => { if (!cancelled) setEntry(null) })
    listSkillFiles(identity, skillName)
      .then(files => {
        if (cancelled) return
        setSupportingCount(files.filter(f => f.relativePath !== 'SKILL.md').length)
      })
      .catch(() => { if (!cancelled) setSupportingCount(null) })
    return () => { cancelled = true }
  }, [identity, relativePath, skillName, notice])

  const displayName = entry?.displayName ?? entry?.name ?? skillName
  const visibility = entry?.visibility
  const subtitle = notice ?? 'Open, change visibility, or delete this skill.'

  const options: Array<SelectOption<SkillAction>> = []
  const noop: SkillAction = { kind: 'noop' }

  options.push({ value: noop, role: 'section', label: 'Open' })
  options.push({
    value: { kind: 'open' },
    label: 'Open SKILL.md',
    hint: 'View or edit this skill',
  })

  options.push({ value: noop, role: 'section', label: 'Visibility' })
  options.push(visibilityOption('private', visibility))
  options.push(visibilityOption('public', visibility))

  options.push({ value: noop, role: 'section', label: 'Manage' })
  options.push({
    value: { kind: 'delete' },
    label: 'Delete',
    hint: 'Remove this skill folder and its supporting files',
  })
  options.push({ value: noop, role: 'section', label: 'Return' })
  options.push({
    value: { kind: 'back' },
    label: 'Back',
    hint: 'Return to Skills',
    role: 'utility',
  })

  const leafMeta = formatLeafMeta(visibility, supportingCount)

  return (
    <Surface title={`Skill · ${displayName}`} subtitle={subtitle} footer={footer}>
      <Box flexDirection="column" marginTop={1}>
        <Text color={theme.dim}>skills/</Text>
        <Text>
          <Text color={theme.dim}>└── </Text>
          <Text color={theme.accentPeriwinkle} bold>{`${skillName}/SKILL.md`}</Text>
          {leafMeta ? <Text color={theme.dim}>{`   ${leafMeta}`}</Text> : null}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Select<SkillAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice.kind === 'open') return onOpenSkill(relativePath)
            if (choice.kind === 'set-visibility') return onSetVisibility(relativePath, choice.visibility)
            if (choice.kind === 'delete') return onDelete(relativePath)
            if (choice.kind === 'back') return onBack()
          }}
          onCancel={onBack}
        />
      </Box>
    </Surface>
  )
}

function formatLeafMeta(visibility: SkillVisibility | undefined, supportingCount: number | null): string {
  if (!visibility) return ''
  const fileLabel = supportingCount === null
    ? null
    : supportingCount === 0 ? '1 file' : `${supportingCount + 1} files`
  return fileLabel ? `${capitalize(visibility)} · ${fileLabel}` : capitalize(visibility)
}

function visibilityOption(level: SkillVisibility, current?: SkillVisibility): SelectOption<SkillAction> {
  const isCurrent = current === level
  const hint = visibilityHint(level) + (isCurrent ? '  ·  current' : '')
  const base: SelectOption<SkillAction> = {
    value: { kind: 'set-visibility', visibility: level },
    label: `Set ${capitalize(level)}`,
    hint,
  }
  if (isCurrent) base.labelColor = theme.accentPeriwinkle
  return base
}

function visibilityHint(level: SkillVisibility): string {
  if (level === 'private') return 'Local-only. Not in skills.json.'
  return 'Default. Indexed with description and Agent Card link.'
}

function capitalize(value: string): string {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1)
}
