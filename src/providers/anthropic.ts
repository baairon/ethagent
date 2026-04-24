import { getKey } from '../storage/secrets.js'
import type { Message, MessageContentBlock, Provider, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { iterSseEvents } from './sse.js'
import { fetchWithRetry } from '../utils/withRetry.js'

export type AnthropicToolDefinition = {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

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
    stop_reason?: string
    partial_json?: string
  }
  content_block?: {
    type?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }
  index?: number
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
  readonly supportsTools: boolean
  private readonly tools: AnthropicToolDefinition[]

  constructor(opts: { model: string; tools?: AnthropicToolDefinition[] }) {
    this.model = opts.model
    this.tools = opts.tools ?? []
    this.supportsTools = this.tools.length > 0
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
      response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
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
          tools: this.tools.length > 0 ? this.tools : undefined,
        }),
      }, { signal })
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
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown' = 'unknown'
    const toolBuffers = new Map<number, { id: string; name: string; json: string }>()

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
        if (type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
          const id = parsed.content_block.id ?? `tool-${parsed.index ?? 0}`
          const name = parsed.content_block.name ?? 'unknown'
          const json = parsed.content_block.input ? JSON.stringify(parsed.content_block.input) : ''
          toolBuffers.set(parsed.index ?? 0, { id, name, json })
          yield { type: 'tool_use_start', id, name }
          continue
        }
        if (type === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            yield { type: 'text', delta: parsed.delta.text }
          } else if (parsed.delta?.type === 'thinking_delta' && parsed.delta.thinking) {
            yield { type: 'thinking', delta: parsed.delta.thinking }
          } else if (parsed.delta?.type === 'input_json_delta' && typeof parsed.delta.partial_json === 'string') {
            const buffer = toolBuffers.get(parsed.index ?? 0)
            if (buffer) {
              buffer.json += parsed.delta.partial_json
              yield { type: 'tool_use_delta', id: buffer.id, delta: parsed.delta.partial_json }
            }
          }
          continue
        }
        if (type === 'content_block_stop') {
          const buffer = toolBuffers.get(parsed.index ?? 0)
          if (buffer) {
            let input: Record<string, unknown> = {}
            try {
              input = buffer.json.trim() ? JSON.parse(buffer.json) as Record<string, unknown> : {}
            } catch {
              input = {}
            }
            yield { type: 'tool_use_stop', id: buffer.id, name: buffer.name, input }
            toolBuffers.delete(parsed.index ?? 0)
          }
          continue
        }
        if (type === 'message_delta') {
          inputTokens = parsed.usage?.input_tokens ?? inputTokens
          outputTokens = parsed.usage?.output_tokens ?? outputTokens
          stopReason = normalizeStopReason(parsed.delta?.stop_reason)
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
    yield { type: 'done', inputTokens, outputTokens, stopReason }
  }
}

function splitMessages(messages: Message[]): {
  system?: string
  conversation: Array<{
    role: 'user' | 'assistant'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
    >
  }>
} {
  const systemParts: string[] = []
  const conversation: Array<{
    role: 'user' | 'assistant'
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
    >
  }> = []

  for (const message of messages) {
    const blocks = normalizeBlocks(message.content)
    if (blocks.length === 0) continue
    if (message.role === 'system') {
      const systemText = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n\n').trim()
      if (systemText) systemParts.push(systemText)
      continue
    }
    conversation.push({
      role: message.role,
      content: blocks.map(block => {
        if (block.type === 'text') return { type: 'text', text: block.text }
        if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
        return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.content, is_error: block.isError }
      }),
    })
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    conversation,
  }
}

function normalizeBlocks(content: Message['content']): MessageContentBlock[] {
  if (typeof content === 'string') {
    const text = content.trim()
    return text ? [{ type: 'text', text }] : []
  }
  return content.filter(block => {
    if (block.type === 'text') return block.text.trim().length > 0
    return true
  })
}

function normalizeStopReason(value?: string): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown' {
  if (value === 'end_turn' || value === 'tool_use' || value === 'max_tokens' || value === 'stop_sequence') {
    return value
  }
  return 'unknown'
}
