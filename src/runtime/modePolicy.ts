import type { SessionMode } from './sessionMode.js'
import type { ToolKind } from '../tools/contracts.js'

type PolicyMode = SessionMode | 'default'

export type ModePolicy = {
  mode: PolicyMode
  exposesToolKind: (kind: ToolKind) => boolean
  autoAllowToolKind: (kind: ToolKind) => boolean
  promptLabel: string
}

export function modePolicy(mode: PolicyMode): ModePolicy {
  if (mode === 'plan') {
    return {
      mode,
      exposesToolKind: kind => kind === 'read',
      autoAllowToolKind: () => false,
      promptLabel: 'plan mode',
    }
  }

  if (mode === 'accept-edits') {
    return {
      mode,
      exposesToolKind: () => true,
      autoAllowToolKind: kind => kind === 'read' || kind === 'edit' || kind === 'write',
      promptLabel: 'accept edits',
    }
  }

  return {
    mode,
    exposesToolKind: () => true,
    autoAllowToolKind: () => false,
    promptLabel: 'default chat',
  }
}
