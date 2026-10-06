import React, { useEffect, useState } from 'react'
import { Box } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
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
  const subtitle = notice ?? formatLeafMeta(visibility, supportingCount)

  const options: Array<SelectOption<SkillAction>> = []

  options.push({
    value: { kind: 'open' },
    label: 'Open SKILL.md',
    hint: 'In your editor',
  })
  options.push(visibilityOption(visibility === 'public' ? 'private' : 'public'))
  options.push({
    value: { kind: 'delete' },
    label: 'Delete Skill',
  })
  options.push({
    value: { kind: 'back' },
    label: 'Back',
    role: 'utility',
  })

  return (
    <Surface title={displayName} subtitle={subtitle || undefined} footer={footer}>
      <Box>
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
  const where = visibility === 'public' ? 'Public, listed on your Agent Card' : 'Private, never listed'
  return fileLabel ? `${where} · ${fileLabel}` : where
}

function visibilityOption(level: SkillVisibility): SelectOption<SkillAction> {
  return {
    value: { kind: 'set-visibility', visibility: level },
    label: level === 'public' ? 'Make Public' : 'Make Private',
    hint: level === 'public' ? 'Show on your Agent Card' : 'Hide from your Agent Card',
  }
}

