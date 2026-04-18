import type { ProviderId } from '../storage/config.js'
import type { Message, Provider, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { iterSseFrames } from './sse.js'

type Options = {
  id: ProviderId
  model: string
  baseUrl: string
  apiKey?: string
  loadApiKey?: () => Promise<string | null>
}

type ChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  } | null
}

const READ_TIMEOUT_MS = 45_000

export class OpenAIChatProvider implements Provider {
  readonly id: ProviderId
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly loadApiKey?: () => Promise<string | null>

  constructor(opts: Options) {
    this.id = opts.id
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey ?? ''
    this.loadApiKey = opts.loadApiKey
  }

  async *complete(messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = await this.resolveApiKey()
    if (!apiKey && this.id !== 'ollama') {
      const error = new ProviderError(`missing API key for ${this.id} (/doctor to verify)`)
      yield { type: 'error', message: error.message }
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal,
      })
    } catch (err: unknown) {
      if (signal.aborted) return
      const message = (err as Error).message || 'network error'
      yield { type: 'error', message }
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
      for await (const frame of iterSseFrames(response.body, signal, READ_TIMEOUT_MS)) {
        if (frame === '[DONE]') break
        let parsed: ChatChunk
        try {
          parsed = JSON.parse(frame) as ChatChunk
        } catch {
          continue
        }
        const delta = parsed.choices?.[0]?.delta
        const text = typeof delta?.content === 'string' ? delta.content : ''
        const reasoning =
          typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta?.reasoning === 'string'
              ? delta.reasoning
              : ''
        if (reasoning.length > 0) {
          yield { type: 'thinking', delta: reasoning }
        }
        if (text.length > 0) {
          yield { type: 'text', delta: text }
        }
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? inputTokens
          outputTokens = parsed.usage.completion_tokens ?? outputTokens
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

  private async resolveApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey
    if (!this.loadApiKey) return ''
    return (await this.loadApiKey()) ?? ''
  }
}
