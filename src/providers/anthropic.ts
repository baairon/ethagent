import { getKey } from '../storage/secrets.js'
import type { Message, Provider, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { iterSseEvents } from './sse.js'

type AnthropicStreamMessage = {
  type?: string
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
    }
  }
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  delta?: {
    type?: string
    text?: string
    thinking?: string
  }
  error?: {
    type?: string
    message?: string
  }
}

const ANTHROPIC_VERSION = '2023-06-01'
const READ_TIMEOUT_MS = 45_000
const DEFAULT_MAX_TOKENS = 4096

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic' as const
  readonly model: string

  constructor(opts: { model: string }) {
    this.model = opts.model
  }

  async *complete(messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = await getKey('anthropic')
    if (!apiKey) {
      const error = new ProviderError('missing API key for anthropic (/doctor to verify)')
      yield { type: 'error', message: error.message }
      return
    }

    const { system, conversation } = splitMessages(messages)

    let response: Response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'anthropic-version': ANTHROPIC_VERSION,
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          stream: true,
          system,
          messages: conversation,
        }),
        signal,
      })
    } catch (err: unknown) {
      if (signal.aborted) return
      yield { type: 'error', message: (err as Error).message || 'network error' }
      return
    }

    if (!response.ok) {
      const error = await providerErrorFromResponse(this.id, response)
      yield { type: 'error', message: error.message }
      return
    }
    if (!response.body) {
      yield { type: 'error', message: 'empty response body' }
      return
    }

    let inputTokens: number | undefined
    let outputTokens: number | undefined

    try {
      for await (const frame of iterSseEvents(response.body, signal, READ_TIMEOUT_MS)) {
        const eventType = frame.event
        let parsed: AnthropicStreamMessage
        try {
          parsed = JSON.parse(frame.data) as AnthropicStreamMessage
        } catch {
          continue
        }

        const type = parsed.type ?? eventType ?? ''
        if (type === 'message_start') {
          inputTokens = parsed.message?.usage?.input_tokens ?? inputTokens
          outputTokens = parsed.message?.usage?.output_tokens ?? outputTokens
          continue
        }
        if (type === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            yield { type: 'text', delta: parsed.delta.text }
          }
          continue
        }
        if (type === 'message_delta') {
          inputTokens = parsed.usage?.input_tokens ?? inputTokens
          outputTokens = parsed.usage?.output_tokens ?? outputTokens
          continue
        }
        if (type === 'error') {
          const message = parsed.error?.message || 'anthropic stream error'
          const transient = parsed.error?.type === 'overloaded_error' || parsed.error?.type === 'rate_limit_error'
          throw new ProviderError(message, { transient })
        }
        if (type === 'message_stop') {
          break
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return
      yield { type: 'error', message: (err as Error).message || 'stream error' }
      return
    }

    if (signal.aborted) return
    yield { type: 'done', inputTokens, outputTokens }
  }
}

function splitMessages(messages: Message[]): {
  system?: string
  conversation: Array<{
    role: 'user' | 'assistant'
    content: Array<{ type: 'text'; text: string }>
  }>
} {
  const systemParts: string[] = []
  const conversation: Array<{
    role: 'user' | 'assistant'
    content: Array<{ type: 'text'; text: string }>
  }> = []

  for (const message of messages) {
    if (!message.content.trim()) continue
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }
    conversation.push({
      role: message.role,
      content: [{ type: 'text', text: message.content }],
    })
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    conversation,
  }
}
