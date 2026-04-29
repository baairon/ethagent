import type { ProviderId } from '../storage/config.js'

export type Role = 'system' | 'user' | 'assistant'

export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type ToolResultBlock = {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export type MessageContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

export type Message = {
  role: Role
  content: string | MessageContentBlock[]
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; inputTokens?: number; outputTokens?: number; stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown' }
  | { type: 'error'; message: string }

export type ProviderCompleteOptions = {
  maxTokens?: number
}

export interface Provider {
  readonly id: ProviderId
  readonly model: string
  readonly supportsTools: boolean
  complete(messages: Message[], signal: AbortSignal, options?: ProviderCompleteOptions): AsyncIterable<StreamEvent>
}

export class ProviderError extends Error {
  readonly transient: boolean
  constructor(message: string, options: { transient?: boolean } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.transient = options.transient ?? false
  }
}
