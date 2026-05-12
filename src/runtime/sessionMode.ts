import type { ToolKind } from '../tools/contracts.js'

export type SessionMode = 'chat' | 'plan' | 'accept-edits'

export type PermissionMode = 'default' | 'plan' | 'accept-edits'

type PolicyMode = SessionMode | 'default'

export type ModePolicy = {
  mode: PolicyMode
  exposesToolKind: (kind: ToolKind) => boolean
  autoAllowToolKind: (kind: ToolKind) => boolean
  promptLabel: string
}

export function toPermissionMode(mode: SessionMode): PermissionMode {
  if (mode === 'plan') return 'plan'
  if (mode === 'accept-edits') return 'accept-edits'
  return 'default'
}

export function nextSessionMode(mode: SessionMode): SessionMode {
  return mode === 'chat' ? 'plan' : mode === 'plan' ? 'accept-edits' : 'chat'
}

export function sessionModeLabel(mode: SessionMode): string {
  return mode === 'plan' ? 'plan mode' : mode === 'accept-edits' ? 'accept edits on' : ''
}

export function modePolicy(mode: PolicyMode): ModePolicy {
  if (mode === 'plan') {
    return {
      mode,
      exposesToolKind: kind => kind === 'read' || kind === 'private-continuity-read' || kind === 'mcp',
      autoAllowToolKind: kind => kind === 'private-continuity-read',
      promptLabel: 'plan mode',
    }
  }

  if (mode === 'accept-edits') {
    return {
      mode,
      exposesToolKind: () => true,
      autoAllowToolKind: kind => kind === 'read' || kind === 'edit' || kind === 'write' || kind === 'private-continuity-read',
      promptLabel: 'accept edits',
    }
  }

  return {
    mode,
    exposesToolKind: () => true,
    autoAllowToolKind: kind => kind === 'private-continuity-read',
    promptLabel: 'default chat',
  }
}
