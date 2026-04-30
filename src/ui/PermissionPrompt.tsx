import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { Surface } from './Surface.js'
import { Select } from './Select.js'
import { theme } from './theme.js'
import type { PermissionDecision, PermissionRequest } from '../tools/contracts.js'

type PermissionPromptProps = {
  request: PermissionRequest
  onDecision: (decision: PermissionDecision) => void
  onCancel: () => void
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({ request, onDecision, onCancel }) => {
  const options = useMemo(() => permissionOptionsForRequest(request), [request])

  return (
    <Surface
      title={request.title}
      subtitle={request.subtitle}
      tone={request.kind === 'bash' && request.warning ? 'error' : 'primary'}
      footer="enter confirms · esc denies"
    >
      {request.kind === 'private-continuity-edit' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentPeach}>{request.changeSummary}</Text>
          <Text color={theme.textSubtle}>
            Not reversible by /rewind. A private identity-history snapshot is saved before the edit is applied.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>target</Text>
          </Box>
          <Text color={theme.text}>{request.file}</Text>
          <Box marginTop={1}>
            <Text color={theme.accentPrimary}>diff</Text>
          </Box>
          <Text color={theme.text}>{request.diff}</Text>
        </Box>
      ) : null}
      {request.kind === 'private-continuity-read' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentPeach}>read private {request.file}</Text>
          <Text color={theme.textSubtle}>This reveals private identity continuity to the model for this turn.</Text>
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>range</Text>
          </Box>
          <Text color={theme.text}>{request.range}</Text>
        </Box>
      ) : null}
      {request.kind === 'edit' || request.kind === 'write' || request.kind === 'delete' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentPeach}>{request.changeSummary}</Text>
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>before</Text>
          </Box>
          <Text color={theme.textSubtle}>{request.before || '(empty)'}</Text>
          <Box marginTop={1}>
            <Text color={theme.accentPrimary}>after</Text>
          </Box>
          <Text color={theme.text}>{request.after || '(empty)'}</Text>
        </Box>
      ) : null}
      {request.kind === 'bash' && request.warning ? (
        <Box marginBottom={1}>
          <Text color="#e87070">{request.warning}</Text>
        </Box>
      ) : null}
      <Select options={options} onSubmit={onDecision} onCancel={onCancel} />
    </Surface>
  )
}

export function permissionOptionsForRequest(request: PermissionRequest): Array<{ value: PermissionDecision; label: string; hint?: string; disabled?: boolean }> {
  if (request.kind === 'bash') {
    return [
      { value: 'allow-once', label: 'allow once', hint: 'approve only this command execution' },
      {
        value: 'allow-command-project',
        label: 'always allow this exact command',
        hint: 'remember this command text for this project',
        disabled: !request.canPersistExact,
      },
      {
        value: 'allow-command-prefix-project',
        label: request.commandPrefix ? `always allow ${request.commandPrefix} commands` : 'allow command prefix',
        hint: 'remember this base command in this working directory for this project',
        disabled: !request.canPersistPrefix,
      },
      { value: 'deny', label: 'deny', hint: 'return a denial back to the model' },
    ]
  }

  if (request.kind === 'delete') {
    return [
      { value: 'allow-once', label: 'delete this file', hint: 'approve this deletion only' },
      { value: 'deny', label: 'deny', hint: 'keep the file unchanged' },
    ]
  }

  if (request.kind === 'private-continuity-read') {
    return [
      { value: 'allow-once', label: 'allow once', hint: `read ${request.file}` },
      { value: 'deny', label: 'deny', hint: 'keep private continuity hidden' },
    ]
  }

  if (request.kind === 'private-continuity-edit') {
    return [
      { value: 'allow-once', label: 'approve once', hint: `apply this edit to ${request.file}` },
      { value: 'deny', label: 'deny', hint: 'keep private continuity unchanged' },
    ]
  }

  return [
    { value: 'allow-once', label: 'allow once', hint: 'approve only this action' },
    { value: 'allow-path-project', label: 'always allow this file', hint: request.relativePath },
    { value: 'allow-directory-project', label: 'always allow this folder', hint: request.directoryPath },
    {
      value: 'allow-kind-project',
      label:
        request.kind === 'edit'
          ? 'always allow edits'
          : request.kind === 'write'
            ? 'always allow writes'
          : request.kind === 'cd'
            ? 'always allow directory changes'
            : 'always allow reads',
      hint: 'remember this tool kind for this project',
    },
    { value: 'deny', label: 'deny', hint: 'return a denial back to the model' },
  ]
}
