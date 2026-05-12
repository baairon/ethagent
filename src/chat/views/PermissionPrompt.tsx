import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { Surface } from '../../ui/Surface.js'
import { Select } from '../../ui/Select.js'
import { theme } from '../../ui/theme.js'
import { DiffView, diffLineColor } from '../display/DiffView.js'
import type { PermissionDecision, PermissionRequest } from '../../tools/contracts.js'

export { diffLineColor as permissionDiffLineColor }

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
          <Text color={theme.accentPeriwinkle}>{displayPermissionText(request.changeSummary)}</Text>
          <Text color={theme.textSubtle}>
            Not reversible by /rewind. A private identity-history snapshot is saved before writing.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>target</Text>
          </Box>
          <Text color={theme.text}>{request.file}</Text>
          <Box marginTop={1}>
            <Text color={theme.accentPeriwinkle}>diff</Text>
          </Box>
          <DiffView diff={request.diff} />
        </Box>
      ) : null}
      {request.kind === 'private-continuity-read' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentPeriwinkle}>read private {request.file}</Text>
          <Text color={theme.textSubtle}>This reveals private identity continuity to the model for this turn.</Text>
          <Box marginTop={1}>
            <Text color={theme.textSubtle}>range</Text>
          </Box>
          <Text color={theme.text}>{request.range}</Text>
        </Box>
      ) : null}
      {request.kind === 'edit' || request.kind === 'write' || request.kind === 'delete' ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.accentPeriwinkle}>{displayPermissionText(request.changeSummary)}</Text>
          <Box marginTop={1}>
            <Text color={theme.accentPeriwinkle}>diff</Text>
          </Box>
          <DiffView diff={request.diff} />
        </Box>
      ) : null}
      {request.kind === 'bash' && request.warning ? (
        <Box marginBottom={1}>
          <Text color={theme.accentError}>{request.warning}</Text>
        </Box>
      ) : null}
      <Select options={options} onSubmit={onDecision} onCancel={onCancel} />
    </Surface>
  )
}

export function permissionOptionsForRequest(request: PermissionRequest): Array<{ value: PermissionDecision; label: string; hint?: string; disabled?: boolean }> {
  if (request.kind === 'bash') {
    return [
      { value: 'allow-once', label: 'Allow once', hint: 'Approve only this command execution' },
      {
        value: 'allow-command-project',
        label: 'Allow exact command',
        hint: 'Remember this exact command for this project',
        disabled: !request.canPersistExact,
      },
      {
        value: 'allow-command-prefix-project',
        label: request.commandPrefix ? `Allow ${request.commandPrefix} commands` : 'Allow command family',
        hint: 'Remember this base command in this working directory for this project',
        disabled: !request.canPersistPrefix,
      },
      { value: 'deny', label: 'Deny', hint: 'Return a denial to the model' },
    ]
  }

  if (request.kind === 'mcp') {
    const risk = request.destructive
      ? 'Server marks this tool as destructive'
      : request.openWorld
        ? 'Server marks this tool as open-world'
        : request.readOnly
          ? 'Server marks this tool as read-only'
          : 'Server did not mark this tool read-only'
    return [
      { value: 'allow-once', label: 'Allow once', hint: risk },
      { value: 'allow-mcp-tool-project', label: 'Always allow this MCP tool', hint: request.toolKey },
      {
        value: 'allow-mcp-server-project',
        label: `Always allow ${request.serverName}`,
        hint: 'Remember all tools from this MCP server for this project',
        disabled: !request.canPersistServer,
      },
      { value: 'deny', label: 'Deny', hint: 'Return a denial back to the model' },
    ]
  }

  if (request.kind === 'delete') {
    return [
      { value: 'allow-once', label: 'Delete this file', hint: 'Approve this deletion only' },
      { value: 'deny', label: 'Deny', hint: 'Keep the file unchanged' },
    ]
  }

  if (request.kind === 'private-continuity-read') {
    return [
      { value: 'allow-once', label: 'Allow once', hint: `Read ${request.file}` },
      { value: 'deny', label: 'Deny', hint: 'Keep private continuity hidden' },
    ]
  }

  if (request.kind === 'private-continuity-edit') {
    return [
      { value: 'allow-once', label: 'Approve once', hint: `Apply this edit to ${request.file}` },
      { value: 'deny', label: 'Deny', hint: 'Keep private continuity unchanged' },
    ]
  }

  return [
    { value: 'allow-once', label: 'Allow once', hint: 'Approve only this action' },
    { value: 'allow-path-project', label: 'Always allow this file', hint: request.relativePath },
    { value: 'allow-directory-project', label: 'Always allow this folder', hint: request.directoryPath },
    {
      value: 'allow-kind-project',
      label:
        request.kind === 'edit'
          ? 'Always allow edits'
          : request.kind === 'write'
            ? 'Always allow writes'
          : request.kind === 'cd'
            ? 'Always allow directory changes'
            : 'Always allow reads',
      hint: 'Remember this tool kind for this project',
    },
    { value: 'deny', label: 'Deny', hint: 'Return a denial back to the model' },
  ]
}

function displayPermissionText(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value
}
