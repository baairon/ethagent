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
  const options = useMemo(() => buildOptions(request), [request])

  return (
    <Surface
      title={request.title}
      subtitle={request.subtitle}
      tone={request.kind === 'bash' && request.warning ? 'error' : 'primary'}
      footer="enter confirms · esc denies"
    >
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

function buildOptions(request: PermissionRequest): Array<{ value: PermissionDecision; label: string; hint?: string; disabled?: boolean }> {
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
