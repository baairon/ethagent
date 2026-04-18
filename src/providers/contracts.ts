import type { ProviderId } from '../storage/config.js'

export type Role = 'system' | 'user' | 'assistant'

export type Message = {
  role: Role
  content: string
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'done'; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; message: string }

export interface Provider {
  readonly id: ProviderId
  readonly model: string
  complete(messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent>
}

export class ProviderError extends Error {
  readonly transient: boolean
  constructor(message: string, options: { transient?: boolean } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.transient = options.transient ?? false
  }
}
