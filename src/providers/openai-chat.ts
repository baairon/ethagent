import type { ProviderId } from '../storage/config.js'
import type { Message, Provider, ProviderCompleteOptions, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { fetchWithRetryStreamEvents } from './retry.js'
import { iterSseFrames } from './sse.js'
import { hasImageBlocks, ImageLoadError } from '../utils/images.js'
import { providerDisplayName } from '../models/providerDisplay.js'
import { toWireMessages } from './openaiChatWire.js'

export { toWireMessages } from './openaiChatWire.js'

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
  hasVisionProjector?: boolean
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
  private readonly hasVisionProjector: boolean

  constructor(opts: Options) {
    this.id = opts.id
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey ?? ''
    this.loadApiKey = opts.loadApiKey
    this.tools = opts.tools ?? []
    this.maxRetries = opts.maxRetries
    this.supportsTools = this.tools.length > 0
    this.hasVisionProjector = opts.hasVisionProjector ?? false
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
    if (hasImageBlocks(messages)) {
      if (this.id === 'llamacpp' && !this.hasVisionProjector) {
        const hint = localModelNameHintsVision(this.model)
          ? '; open alt+p and run "Add Vision Encoder" on this model to enable image input'
          : ''
        yield { type: 'error', message: `image input is not enabled for local model "${this.model}" (no vision projector loaded)${hint}` }
        return
      }
      if (this.id === 'openai' && !supportsOpenAIImages(this.model)) {
        yield { type: 'error', message: `image input is not enabled for ${this.model}` }
        return
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    let wireMessages: Array<Record<string, unknown>>
    try {
      wireMessages = await toWireMessages(messages)
    } catch (err: unknown) {
      if (err instanceof ImageLoadError) {
        yield { type: 'error', message: err.message }
        return
      }
      throw err
    }

    let response: Response
    try {
      response = yield* fetchWithRetryStreamEvents(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: wireMessages,
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
    let reasoningPending = false

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

        if (reasoning.length > 0) {
          yield { type: 'thinking', delta: reasoning }
          reasoningPending = true
        }
        if (text.length > 0) {
          if (reasoningPending) {
            yield { type: 'thinking_end' }
            reasoningPending = false
          }
          for (const event of contentThinkingParser.push(text)) {
            yield event
          }
        }

        const toolCallDeltas = delta?.tool_calls ?? []
        if (toolCallDeltas.length > 0 && reasoningPending) {
          yield { type: 'thinking_end' }
          reasoningPending = false
        }
        for (const event of applyStreamingToolCallDelta(toolCalls, toolCallDeltas)) {
          yield event
        }

        if (choice?.finish_reason) {
          if (reasoningPending) {
            yield { type: 'thinking_end' }
            reasoningPending = false
          }
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
    if (reasoningPending) {
      yield { type: 'thinking_end' }
      reasoningPending = false
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

export function supportsOpenAIImages(model: string): boolean {
  const normalized = model.toLowerCase()
  if (normalized.includes('gpt-3.5')) return false
  return /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|o1|o3|o4|chatgpt-4/.test(normalized)
}

export function localModelNameHintsVision(model: string): boolean {
  const normalized = model.toLowerCase()
  return /llava|bakllava|qwen[-_.]?vl|qwen2[-_.]?vl|qwen2\.5[-_.]?vl|minicpm-?v|llama-3\.2.*vision|mllama|cogvlm|internvl|moondream|pixtral|phi-?3[\.-]?vision|phi-?3\.5[\.-]?vision|smolvlm/.test(normalized)
}

function parseToolArguments(inputJson: string): Record<string, unknown> {
  if (!inputJson.trim()) return {}
  const direct = tryParseJsonOnce(inputJson)
  if (direct !== undefined) return coerceToToolArguments(direct)
  const repaired = repairJsonObject(inputJson)
  if (!repaired) return {}
  const parsedRepaired = tryParseJsonOnce(repaired)
  return parsedRepaired === undefined ? {} : coerceToToolArguments(parsedRepaired)
}

function tryParseJsonOnce(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function coerceToToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const inner = tryParseJsonOnce(trimmed)
      if (inner !== undefined) return coerceToToolArguments(inner)
    }
    return {}
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
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
  return `${providerDisplayName(provider)} request failed at ${baseUrl}: ${message}`
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
        const wasThinking = this.state === 'thinking'
        this.state = this.state === 'text' ? 'thinking' : 'text'
        if (wasThinking) yield { type: 'thinking_end' }
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
