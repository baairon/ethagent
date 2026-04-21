import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from 'ink'
import { clearPermissionRules, deletePermissionRule, loadPermissionRules } from '../storage/permissions.js'
import type { SessionPermissionRule } from '../tools/contracts.js'
import { Select, type SelectOption } from './Select.js'
import { Spinner } from './Spinner.js'
import { Surface } from './Surface.js'
import { theme } from './theme.js'

type PermissionsViewProps = {
  cwd: string
  onRulesChanged: (rules: SessionPermissionRule[]) => void
  onNotice: (message: string, variant?: 'info' | 'error' | 'dim') => void
  onCancel: () => void
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rules: SessionPermissionRule[] }

const CLEAR_ALL_VALUE = '__clear_all__'

export const PermissionsView: React.FC<PermissionsViewProps> = ({
  cwd,
  onRulesChanged,
  onNotice,
  onCancel,
}) => {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rules = await loadPermissionRules(cwd)
        if (!cancelled) setState({ kind: 'ready', rules })
      } catch (err: unknown) {
        if (!cancelled) setState({ kind: 'error', message: (err as Error).message })
      }
    })()
    return () => { cancelled = true }
  }, [cwd])

  const refreshRules = async () => {
    const rules = await loadPermissionRules(cwd)
    setState({ kind: 'ready', rules })
    onRulesChanged(rules)
    return rules
  }

  const options = useMemo(
    () => state.kind === 'ready' ? buildOptions(state.rules) : [],
    [state],
  )

  if (state.kind === 'loading') {
    return (
      <Surface title="Permissions" subtitle="Loading saved project rules...">
        <Spinner label="loading permission rules..." />
      </Surface>
    )
  }

  if (state.kind === 'error') {
    return (
      <Surface title="Permissions" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>{state.message}</Text>
      </Surface>
    )
  }

  if (state.rules.length === 0) {
    return (
      <Surface title="Permissions" tone="muted" footer="Esc closes.">
        <Text color={theme.dim}>No saved permission rules for this project.</Text>
      </Surface>
    )
  }

  return (
    <Surface
      title="Permissions"
      subtitle="Saved rules for this project. Enter removes the selected rule."
      footer="Enter removes. Esc closes."
    >
      <Select
        options={options}
        onSubmit={async value => {
          try {
            if (value === CLEAR_ALL_VALUE) {
              await clearPermissionRules(cwd)
              onRulesChanged([])
              onCancel()
              onNotice('cleared saved permission rules for this project.', 'dim')
              return
            }

            await deletePermissionRule(cwd, value)
            const remaining = await refreshRules()
            if (remaining.length === 0) {
              onCancel()
              onNotice('removed the last saved permission rule for this project.', 'dim')
              return
            }
            onNotice(`removed permission rule: ${describeRule(value)}`, 'dim')
          } catch (err: unknown) {
            onNotice(`failed to update permission rules: ${(err as Error).message}`, 'error')
          }
        }}
        onCancel={onCancel}
      />
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.dim}>Rules apply only within the current project root.</Text>
      </Box>
    </Surface>
  )
}

function buildOptions(rules: SessionPermissionRule[]): Array<SelectOption<SessionPermissionRule | typeof CLEAR_ALL_VALUE>> {
  return [
    ...rules.map(rule => ({
      value: rule,
      label: describeRule(rule),
      hint: describeRuleScope(rule),
    })),
    {
      value: CLEAR_ALL_VALUE,
      label: 'Remove all saved rules',
      hint: 'Clear all remembered permissions for this project',
    },
  ]
}

function describeRule(rule: SessionPermissionRule): string {
  if (rule.kind === 'bash') {
    if (rule.scope === 'command') return `bash exact: ${rule.command}`
    return `bash prefix: ${rule.commandPrefix}`
  }
  if (rule.scope === 'kind') {
    return rule.kind === 'read'
      ? 'allow all reads'
      : rule.kind === 'edit'
        ? 'allow all edits'
        : 'allow all directory changes'
  }
  if (rule.scope === 'path') return `${rule.kind} file: ${rule.path}`
  return `${rule.kind} folder: ${rule.path}`
}

function describeRuleScope(rule: SessionPermissionRule): string {
  if (rule.kind === 'bash') return `cwd ${rule.cwd}`
  return rule.scope === 'kind' ? 'whole project' : rule.path
}
