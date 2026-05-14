import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../../../ui/Surface.js'
import { Select, type SelectOption } from '../../../../ui/Select.js'
import { theme } from '../../../../ui/theme.js'
import type { EthagentIdentity } from '../../../../storage/config.js'
import { listSkills } from '../../../continuity/skills/loadSkills.js'
import type { SkillIndexEntry, SkillVisibility } from '../../../continuity/skills/types.js'

interface SkillVisibilityListProps {
  identity?: EthagentIdentity
  notice?: string
  footer: React.ReactNode
  onPick: (relativePath: string) => void
  onCancel: () => void
}

type PickAction =
  | { kind: 'skill'; relativePath: string }
  | { kind: 'cancel' }

export const SkillVisibilityListScreen: React.FC<SkillVisibilityListProps> = ({
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

  const subtitle = notice ?? 'Pick a skill to change its visibility in the public manifest.'
  const isLoading = entries === null
  const skills = entries ?? []

  const options: Array<SelectOption<PickAction>> = []
  if (isLoading) {
    options.push({ value: { kind: 'cancel' }, role: 'notice', label: 'Loading...', labelColor: theme.dim, indent: 0 })
  } else if (skills.length === 0) {
    options.push({ value: { kind: 'cancel' }, role: 'notice', label: 'No skills yet. Create one first.', labelColor: theme.dim, indent: 0 })
  } else {
    options.push({ value: { kind: 'cancel' }, role: 'section', label: 'Skills' })
    for (const skill of skills) {
      options.push({
        value: { kind: 'skill', relativePath: skill.relativePath },
        label: skill.displayName ?? skill.name,
        hint: visibilityBadge(skill.visibility),
        hintColor: visibilityColor(skill.visibility),
      })
    }
  }
  options.push({ value: { kind: 'cancel' }, role: 'section', label: 'Navigation' })
  options.push({ value: { kind: 'cancel' }, label: 'Back', hint: 'Return to Skills', role: 'utility' })

  return (
    <Surface title="Skill Visibility" subtitle={subtitle} footer={footer}>
      {error && (
        <Box marginTop={1}>
          <Text color={theme.accentError}>{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Select<PickAction>
          options={options}
          hintLayout="inline"
          onSubmit={choice => {
            if (choice.kind === 'cancel') return onCancel()
            return onPick(choice.relativePath)
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}

interface SkillVisibilityPickProps {
  identity?: EthagentIdentity
  relativePath: string
  footer: React.ReactNode
  onSelect: (visibility: SkillVisibility) => void
  onCancel: () => void
}

export const SkillVisibilityPickScreen: React.FC<SkillVisibilityPickProps> = ({
  identity,
  relativePath,
  footer,
  onSelect,
  onCancel,
}) => {
  const [current, setCurrent] = useState<SkillVisibility | null>(null)
  const [displayName, setDisplayName] = useState<string>(relativePath)

  useEffect(() => {
    let cancelled = false
    if (!identity) return () => { cancelled = true }
    listSkills(identity)
      .then(list => {
        if (cancelled) return
        const match = list.find(entry => entry.relativePath === relativePath)
        if (match) {
          setCurrent(match.visibility)
          setDisplayName(match.displayName ?? match.name)
        }
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [identity, relativePath])

  const subtitle = current
    ? `Current: ${current}. Pick a new value.`
    : 'Pick a visibility level.'

  return (
    <Surface title={`Visibility · ${displayName}`} subtitle={subtitle} footer={footer}>
      <Box marginTop={1}>
        <Select<SkillVisibility | 'cancel'>
          options={[
            { value: 'private', label: 'Private', hint: 'Local-only. Not in skills.json.' },
            { value: 'discoverable', label: 'Discoverable', hint: 'Default. Indexed in skills.json with description.' },
            { value: 'public', label: 'Public', hint: 'Indexed in skills.json and Agent Card.' },
            { value: 'cancel', role: 'section', label: 'Navigation' },
            { value: 'cancel', label: 'Back', hint: 'Return to skill list', role: 'utility' },
          ]}
          hintLayout="inline"
          initialIndex={current ? indexForVisibility(current) : 0}
          onSubmit={choice => {
            if (choice === 'cancel') return onCancel()
            return onSelect(choice)
          }}
          onCancel={onCancel}
        />
      </Box>
    </Surface>
  )
}

function visibilityBadge(visibility: SkillVisibility): string {
  if (visibility === 'public') return '[public]'
  if (visibility === 'discoverable') return '[discoverable]'
  return '[private]'
}

function visibilityColor(visibility: SkillVisibility): string {
  if (visibility === 'public') return theme.accentPeriwinkle
  if (visibility === 'discoverable') return theme.textSubtle
  return theme.dim
}

function indexForVisibility(visibility: SkillVisibility): number {
  if (visibility === 'private') return 0
  if (visibility === 'discoverable') return 1
  return 2
}
