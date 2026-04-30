import type { ProviderId } from '../storage/config.js'
import type { Message, MessageContentBlock, Provider, ProviderCompleteOptions, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { fetchWithRetryStreamEvents } from './retry.js'
import { iterSseFrames } from './sse.js'
import { messageTextContent } from '../utils/messages.js'

export type OpenAIToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties?: Record<string, unknown>
      required?: string[]
    }
  }
}

type Options = {
  id: ProviderId
  model: string
  baseUrl: string
  apiKey?: string
  loadApiKey?: () => Promise<string | null>
  tools?: OpenAIToolDefinition[]
  maxRetries?: number
}

type ChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      thinking?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string | null
        type?: 'function'
        function?: {
          name?: string | null
          arguments?: string | null
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  } | null
}

type ToolCallDelta = NonNullable<NonNullable<NonNullable<ChatChunk['choices']>[number]['delta']>['tool_calls']>[number]

type StreamingToolCall = {
  id: string
  name: string
  inputJson: string
  started: boolean
}

const READ_TIMEOUT_MS = 45_000
type DoneStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown'

export class OpenAIChatProvider implements Provider {
  readonly id: ProviderId
  readonly model: string
  readonly supportsTools: boolean
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly loadApiKey?: () => Promise<string | null>
  private readonly tools: OpenAIToolDefinition[]
  private readonly maxRetries?: number

  constructor(opts: Options) {
    this.id = opts.id
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey ?? ''
    this.loadApiKey = opts.loadApiKey
    this.tools = opts.tools ?? []
    this.maxRetries = opts.maxRetries
    this.supportsTools = this.tools.length > 0
  }

  async *complete(
    messages: Message[],
    signal: AbortSignal,
    options: ProviderCompleteOptions = {},
  ): AsyncIterable<StreamEvent> {
    const apiKey = await this.resolveApiKey()
    if (!apiKey && this.id !== 'llamacpp') {
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
      response = yield* fetchWithRetryStreamEvents(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: toWireMessages(messages),
          tools: this.tools.length > 0 ? this.tools : undefined,
          tool_choice: this.tools.length > 0 ? 'auto' : undefined,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: options.maxTokens,
        }),
      }, { signal, maxRetries: this.maxRetries, rateLimitResetProvider: 'openai-compatible' })
    } catch (err: unknown) {
      if (signal.aborted) return
      const message = providerNetworkErrorMessage(this.id, this.baseUrl, err)
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
    let stopReason: DoneStopReason = 'unknown'
    const toolCalls = new Map<number, StreamingToolCall>()
    const contentThinkingParser = new ContentThinkingParser(this.id)

    try {
      for await (const frame of iterSseFrames(response.body, signal, READ_TIMEOUT_MS)) {
        if (frame === '[DONE]') break
        let parsed: ChatChunk
        try {
          parsed = JSON.parse(frame) as ChatChunk
        } catch {
          continue
        }

        const choice = parsed.choices?.[0]
        const delta = choice?.delta
        const text = typeof delta?.content === 'string' ? delta.content : ''
        const reasoning =
          typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta?.reasoning === 'string'
              ? delta.reasoning
              : typeof delta?.thinking === 'string'
                ? delta.thinking
                : ''

        if (reasoning.length > 0) yield { type: 'thinking', delta: reasoning }
        if (text.length > 0) {
          for (const event of contentThinkingParser.push(text)) {
            yield event
          }
        }

        for (const event of applyStreamingToolCallDelta(toolCalls, delta?.tool_calls ?? [])) {
          yield event
        }

        if (choice?.finish_reason) {
          stopReason = normalizeFinishReason(choice.finish_reason)
        }
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? inputTokens
          outputTokens = parsed.usage.completion_tokens ?? outputTokens
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return
      yield { type: 'error', message: providerNetworkErrorMessage(this.id, this.baseUrl, err, 'stream error') }
      return
    }

    if (signal.aborted) return
    for (const event of contentThinkingParser.flush()) {
      yield event
    }

    let streamEmittedToolUses = 0
    if (stopReason === 'tool_use' || toolCalls.size > 0) {
      for (const [, toolCall] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        if (!toolCall.name) continue
        streamEmittedToolUses += 1
        yield {
          type: 'tool_use_stop',
          id: toolCall.id,
          name: toolCall.name,
          input: parseToolArguments(toolCall.inputJson),
        }
      }
    }

    yield { type: 'done', inputTokens, outputTokens, stopReason }
  }

  private async resolveApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey
    if (!this.loadApiKey) return ''
    return (await this.loadApiKey()) ?? ''
  }

}

export function toWireMessages(messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }

    if (message.role === 'assistant') {
      const textParts = message.content.filter(isTextBlock).map(block => block.text)
      const toolCalls = message.content.filter(isToolUseBlock).map(block => ({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      }))
      out.push({
        role: 'assistant',
        content: textParts.join(''),
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
      continue
    }

    const toolResults = message.content.filter(isToolResultBlock)
    if (toolResults.length > 0) {
      for (const block of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: block.toolUseId,
          content: block.content,
        })
      }
      continue
    }

    out.push({ role: message.role, content: messageTextContent(message) })
  }

  return normalizeSystemMessages(out)
}

function normalizeSystemMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const systemContents: string[] = []
  const nonSystem: Array<Record<string, unknown>> = []

  for (const message of messages) {
    if (message.role === 'system') {
      if (typeof message.content === 'string' && message.content.length > 0) {
        systemContents.push(message.content)
      }
      continue
    }
    nonSystem.push(message)
  }

  if (systemContents.length === 0) return nonSystem
  return [
    {
      role: 'system',
      content: systemContents.join('\n\n'),
    },
    ...nonSystem,
  ]
}

function isTextBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'text' }> {
  return block.type === 'text'
}

function isToolUseBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use'
}

function isToolResultBlock(block: MessageContentBlock): block is Extract<MessageContentBlock, { type: 'tool_result' }> {
  return block.type === 'tool_result'
}

function parseToolArguments(inputJson: string): Record<string, unknown> {
  if (!inputJson.trim()) return {}
  try {
    return JSON.parse(inputJson) as Record<string, unknown>
  } catch {
    const repaired = repairJsonObject(inputJson)
    if (!repaired) return {}
    try {
      return JSON.parse(repaired) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

function* applyStreamingToolCallDelta(
  toolCalls: Map<number, StreamingToolCall>,
  deltas: ToolCallDelta[] | undefined,
): Iterable<StreamEvent> {
  for (const toolCallDelta of deltas ?? []) {
    const index = toolCallDelta.index ?? 0
    const existing = toolCalls.get(index) ?? createStreamingToolCall(index, toolCallDelta)

    if (toolCallDelta.id) existing.id = toolCallDelta.id
    if (toolCallDelta.function?.name) existing.name = toolCallDelta.function.name
    if (toolCallDelta.function?.arguments) {
      existing.inputJson += toolCallDelta.function.arguments
    }
    if (!existing.started && existing.name) {
      existing.started = true
      yield { type: 'tool_use_start', id: existing.id, name: existing.name }
    }
    if (toolCallDelta.function?.arguments) {
      yield { type: 'tool_use_delta', id: existing.id, delta: toolCallDelta.function.arguments }
    }

    toolCalls.set(index, existing)
  }
}

function createStreamingToolCall(
  index: number,
  delta: ToolCallDelta,
): StreamingToolCall {
  return {
    id: delta.id ?? `tool-${index}`,
    name: delta.function?.name ?? '',
    inputJson: '',
    started: false,
  }
}

function normalizeFinishReason(reason: string): DoneStopReason {
  if (reason === 'stop') return 'end_turn'
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'length') return 'max_tokens'
  if (reason === 'stop_sequence') return 'stop_sequence'
  return 'unknown'
}

function providerNetworkErrorMessage(
  provider: ProviderId,
  baseUrl: string,
  err: unknown,
  fallback = 'network error',
): string {
  const message = (err as Error).message || fallback
  if (provider !== 'llamacpp') return message
  return `${provider} request failed at ${baseUrl}: ${message}`
}

class ContentThinkingParser {
  private state: 'text' | 'thinking' = 'text'
  private buffer = ''

  constructor(private readonly provider: ProviderId) {}

  *push(delta: string): Iterable<StreamEvent> {
    if (!this.shouldParse()) {
      yield { type: 'text', delta }
      return
    }

    this.buffer += delta
    yield* this.drain(false)
  }

  *flush(): Iterable<StreamEvent> {
    if (!this.shouldParse() || this.buffer.length === 0) return
    const content = this.buffer
    this.buffer = ''
    yield { type: this.state === 'thinking' ? 'thinking' : 'text', delta: content }
  }

  private *drain(flush: boolean): Iterable<StreamEvent> {
    while (this.buffer.length > 0) {
      const tag = this.state === 'text' ? '<think>' : '</think>'
      const tagIndex = indexOfIgnoreCase(this.buffer, tag)

      if (tagIndex !== -1) {
        const before = this.buffer.slice(0, tagIndex)
        if (before.length > 0) {
          yield { type: this.state === 'thinking' ? 'thinking' : 'text', delta: before }
        }
        this.buffer = this.buffer.slice(tagIndex + tag.length)
        this.state = this.state === 'text' ? 'thinking' : 'text'
        continue
      }

      const keep = flush ? 0 : partialTagPrefixLength(this.buffer, tag)
      const emit = this.buffer.slice(0, this.buffer.length - keep)
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      if (emit.length > 0) {
        yield { type: this.state === 'thinking' ? 'thinking' : 'text', delta: emit }
      }
      return
    }
  }

  private shouldParse(): boolean {
    return this.provider === 'llamacpp'
  }
}

function indexOfIgnoreCase(value: string, search: string): number {
  return value.toLowerCase().indexOf(search.toLowerCase())
}

function partialTagPrefixLength(value: string, tag: string): number {
  const max = Math.min(value.length, tag.length - 1)
  const lowerValue = value.toLowerCase()
  const lowerTag = tag.toLowerCase()
  for (let size = max; size > 0; size -= 1) {
    if (lowerValue.endsWith(lowerTag.slice(0, size))) return size
  }
  return 0
}

function repairJsonObject(input: string): string | undefined {
  const start = input.indexOf('{')
  if (start === -1) return undefined

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < input.length; index += 1) {
    const char = input[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return input.slice(start, index + 1)
    }
  }

  return depth > 0 ? `${input.slice(start)}${'}'.repeat(depth)}` : undefined
}
