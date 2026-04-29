import type { ProviderId } from '../storage/config.js'
import type { Message, MessageContentBlock, Provider, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { iterSseFrames } from './sse.js'
import { fetchWithRetry } from '../utils/withRetry.js'
import { messageTextContent } from '../utils/messages.js'

const DEBUG_STREAM = process.env.ETHAGENT_DEBUG_STREAM === '1'

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
}

type ChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
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

  constructor(opts: Options) {
    this.id = opts.id
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey ?? ''
    this.loadApiKey = opts.loadApiKey
    this.tools = opts.tools ?? []
    this.supportsTools = this.tools.length > 0
  }

  async *complete(messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent> {
    const apiKey = await this.resolveApiKey()
    if (!apiKey && this.id !== 'ollama' && this.id !== 'llamacpp') {
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
      response = await fetchWithRetry(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: toWireMessages(messages),
          tools: this.tools.length > 0 ? this.tools : undefined,
          tool_choice: this.tools.length > 0 ? 'auto' : undefined,
          stream: true,
          stream_options: { include_usage: true },
        }),
      }, { signal })
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
    let stopReason: DoneStopReason = 'unknown'
    const toolCalls = new Map<number, StreamingToolCall>()

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
              : ''

        if (reasoning.length > 0) yield { type: 'thinking', delta: reasoning }
        if (text.length > 0) yield { type: 'text', delta: text }

        if (DEBUG_STREAM && delta?.tool_calls?.length) {
          const summary = delta.tool_calls.map(tc => ({
            index: tc.index,
            name: tc.function?.name ?? undefined,
            argsLen: tc.function?.arguments?.length ?? 0,
          }))
          process.stderr.write(`[ethagent] stream tool_calls delta: ${JSON.stringify(summary)}\n`)
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
      yield { type: 'error', message: (err as Error).message || 'stream error' }
      return
    }

    if (signal.aborted) return

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

    if (DEBUG_STREAM) {
      process.stderr.write(
        `[ethagent] stream done ${this.id}: ${streamEmittedToolUses} tool_uses, stopReason=${stopReason}\n`,
      )
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
