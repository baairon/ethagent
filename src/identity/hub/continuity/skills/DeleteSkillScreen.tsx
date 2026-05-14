import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentIdentity } from '../../../../storage/config.js'
import { listSkills } from '../../../continuity/skills/loadSkills.js'
import type { SkillIndexEntry } from '../../../continuity/skills/types.js'

type DeleteTarget =
  | { kind: 'skill'; relativePath: string }
  | { kind: 'cancel' }

interface DeleteSkillScreenProps {
  identity?: EthagentIdentity
  notice?: string
  footer: React.ReactNode
  onPick: (target: { kind: 'skill'; relativePath: string }) => void
  onCancel: () => void
}

export const DeleteSkillScreen: React.FC<DeleteSkillScreenProps> = ({
  identity,
  notice,
  footer,
  onPick,
  onCancel,
}) => {
  const [entries, setEntries] = useState<SkillIndexEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!identity) {
      setEntries([])
      return () => { cancelled = true }
    }
    listSkills(identity)
      .then(list => { if (!cancelled) { setEntries(list); setError(null) } })
      .catch(err => {
        if (cancelled) return
        setEntries([])
        setError(String((err as Error).message ?? err))
      })
    return () => { cancelled = true }
  }, [identity])

  const subtitle = notice ?? 'Pick a skill to delete. The whole folder will be removed.'
  const isLoading = entries === null
  const skills = entries ?? []
  const hasAnything = skills.length > 0

  const options = buildOptions(skills, isLoading)

  return (
    <Surface title="Delete Skill" subtitle={subtitle} footer={footer} tone="error">
      {error && (
        <Box marginTop={1}>
          <Text color={theme.accentError}>{error}</Text>
        </Box>
      )}
      {!isLoading && !hasAnything && (
        <Box marginTop={1}>
          <Text color={theme.dim}>Nothing to delete. The skills tree is empty.</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Select<DeleteTarget>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice.kind === 'cancel') return onCancel()
            return onPick(choice)
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}

function buildOptions(
  entries: SkillIndexEntry[],
  isLoading: boolean,
): Array<SelectOption<DeleteTarget>> {
  const rows: Array<SelectOption<DeleteTarget>> = []
  const noopValue: DeleteTarget = { kind: 'cancel' }

  if (isLoading) {
    rows.push({
      value: noopValue,
      role: 'notice',
      label: 'Loading...',
      labelColor: theme.dim,
      indent: 0,
    })
  } else if (entries.length > 0) {
    rows.push({ value: noopValue, role: 'section', label: 'Targets' })
    rows.push({ value: noopValue, role: 'notice', label: 'skills/', labelColor: theme.dim, indent: 3 })
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (let i = 0; i < sorted.length; i++) {
      const skill = sorted[i]
      if (!skill) continue
      const isLast = i === sorted.length - 1
      const branch = isLast ? '└── ' : '├── '
      rows.push({
        value: { kind: 'skill', relativePath: skill.relativePath },
        label: `${branch}${skill.name}/`,
        indent: 3,
      })
    }
  }

  rows.push({ value: noopValue, role: 'section', label: 'Navigation' })
  rows.push({
    value: { kind: 'cancel' },
    label: 'Back',
    hint: 'Return to Skills',
    role: 'utility',
  })

  return rows
}
