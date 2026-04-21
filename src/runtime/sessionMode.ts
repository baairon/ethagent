export type SessionMode = 'chat' | 'plan' | 'accept-edits'

export type PermissionMode = 'default' | 'plan' | 'accept-edits'

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
