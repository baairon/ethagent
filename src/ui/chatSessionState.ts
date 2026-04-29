import type { EthagentConfig } from '../storage/config.js'
import type { SessionMetadata, SessionMessage } from '../storage/sessions.js'
import type { SessionMode } from '../runtime/sessionMode.js'
import type { MessageRow } from './MessageList.js'
import type { ModelPickerSelection } from './ModelPicker.js'
import { sessionMessagesToRows } from './chatScreenUtils.js'
import { formatModelDisplayName } from './modelDisplay.js'

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
  promptHistory: string[]
  statusStartedAt: number
}

const MAX_PROMPT_HISTORY = 500

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
      notice: `now using ${formatModelDisplayName('ollama', selection.model, { maxLength: 64 })}.`,
      tone: 'info',
    }
  }

  if (selection.kind === 'llamacpp') {
    if (selection.model === currentConfig.model && currentConfig.provider === 'llamacpp') {
      return { kind: 'noop' }
    }
    return {
      kind: 'switch',
      config: {
        ...currentConfig,
        provider: 'llamacpp',
        model: selection.model,
        baseUrl: defaults.defaultBaseUrlFor('llamacpp'),
      },
      notice: `local Hugging Face model ready. now using ${formatModelDisplayName('llamacpp', selection.model, { maxLength: 64 })}.`,
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
    notice: `${selection.keyJustSet ? `${selection.provider} key saved.` : `${selection.provider} ready.`} now using ${nextConfig.provider} - ${formatModelDisplayName(nextConfig.provider, nextConfig.model, { maxLength: 64 })}.`,
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
        content: formatResumeNote(args.metadata),
      },
    ],
    promptHistory: promptHistoryFromSessionMessages(args.messages),
    statusStartedAt: Date.now(),
  }
}

function formatResumeNote(metadata: SessionMetadata | null): string {
  const id = metadata?.id?.slice(0, 8) ?? ''
  const source = metadata?.compactedFromSessionId ? ` summarized from ${metadata.compactedFromSessionId.slice(0, 8)}` : ''
  return `resumed from session ${id}.${source}`.trim()
}

export function restoreConversationState(
  messages: SessionMessage[],
  turnId: string,
  nextRowId: () => string,
): {
  messages: SessionMessage[]
  rows: MessageRow[]
  promptHistory: string[]
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
    promptHistory: promptHistoryFromSessionMessages(nextMessages),
    truncated: firstIndex >= 0,
  }
}

export function promptHistoryFromSessionMessages(messages: SessionMessage[]): string[] {
  const prompts: string[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (message.synthetic) continue
    const prompt = message.content.trim()
    if (!prompt) continue
    if (prompts[prompts.length - 1] === prompt) continue
    prompts.push(prompt)
  }
  return prompts.slice(-MAX_PROMPT_HISTORY)
}
