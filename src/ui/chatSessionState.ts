import type { EthagentConfig } from '../storage/config.js'
import type { SessionMetadata, SessionMessage } from '../storage/sessions.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import type { MessageRow } from './MessageList.js'
import type { ModelPickerSelection } from './ModelPicker.js'
import { sessionMessagesToRows } from './chatScreenUtils.js'

export type ModelSelectionResolution =
  | { kind: 'noop' }
  | {
      kind: 'switch'
      config: EthagentConfig
      notice: string
      tone: 'info' | 'dim'
    }

export type ResumedSessionState = {
  cwd: string
  config: EthagentConfig | null
  mode: SessionMode
  rows: MessageRow[]
  statusStartedAt: number
}

export function resolveModelSelection(
  selection: ModelPickerSelection,
  currentConfig: EthagentConfig,
  defaults: {
    defaultBaseUrlFor: (provider: EthagentConfig['provider']) => string | undefined
    defaultModelFor: (provider: EthagentConfig['provider']) => string
  },
): ModelSelectionResolution {
  if (selection.kind === 'ollama') {
    if (selection.model === currentConfig.model && currentConfig.provider === 'ollama') {
      return { kind: 'noop' }
    }
    return {
      kind: 'switch',
      config: {
        ...currentConfig,
        provider: 'ollama',
        model: selection.model,
        baseUrl: currentConfig.baseUrl ?? defaults.defaultBaseUrlFor('ollama'),
      },
      notice: `now using ${selection.model}.`,
      tone: 'info',
    }
  }

  const nextProvider = selection.provider
  const nextBaseUrl =
    nextProvider === 'openai' && currentConfig.provider === 'openai'
      ? currentConfig.baseUrl
      : undefined
  const nextConfig: EthagentConfig = {
    ...currentConfig,
    provider: nextProvider,
    model: selection.model,
    baseUrl: nextBaseUrl,
  }

  return {
    kind: 'switch',
    config: nextConfig,
    notice: `${selection.keyJustSet ? `${selection.provider} key saved.` : `${selection.provider} ready.`} now using ${nextConfig.provider} · ${nextConfig.model}.`,
    tone: 'dim',
  }
}

export function buildResumedSessionState(args: {
  messages: SessionMessage[]
  metadata: SessionMetadata | null
  fallbackCwd: string
  currentConfig: EthagentConfig
  nextRowId: () => string
}): ResumedSessionState {
  const cwd = args.metadata?.lastCwd ?? args.metadata?.workspaceRoot ?? args.fallbackCwd
  return {
    cwd,
    config:
      args.metadata?.provider && args.metadata?.model
        ? {
            ...args.currentConfig,
            provider: args.metadata.provider as EthagentConfig['provider'],
            model: args.metadata.model,
          }
        : null,
    mode: args.metadata?.mode ?? 'chat',
    rows: [
      ...sessionMessagesToRows(args.messages, args.nextRowId),
      {
        role: 'note',
        id: args.nextRowId(),
        kind: 'dim',
        content: `resumed from session ${args.metadata?.id?.slice(0, 8) ?? ''}`.trim(),
      },
    ],
    statusStartedAt: Date.now(),
  }
}

export function restoreConversationState(
  messages: SessionMessage[],
  turnId: string,
  nextRowId: () => string,
): {
  messages: SessionMessage[]
  rows: MessageRow[]
  truncated: boolean
} {
  const firstIndex = messages.findIndex(message => message.turnId === turnId)
  const nextMessages =
    firstIndex >= 0
      ? messages.slice(0, firstIndex)
      : messages.filter(message => message.turnId !== turnId)

  return {
    messages: nextMessages,
    rows: sessionMessagesToRows(nextMessages, nextRowId),
    truncated: firstIndex >= 0,
  }
}
