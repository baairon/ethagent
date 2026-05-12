import type { ProviderId } from '../storage/config.js'
import type { Message, Provider, ProviderCompleteOptions, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { fetchWithRetryStreamEvents } from './retry.js'
import { iterSseEvents } from './sse.js'
import { buildResponsesBody } from './openai-responses-format.js'
import { supportsOpenAIImages, type OpenAIToolDefinition } from './openai-chat.js'
import { hasImageBlocks, ImageLoadError } from '../utils/images.js'

const READ_TIMEOUT_MS = 45_000

type DoneStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown'

export type OpenAIResponsesProviderOptions = {
  model: string
  baseUrl: string
  accessToken: string
  accountId?: string
  originator?: string
  tools?: OpenAIToolDefinition[]
  maxRetries?: number
  refresh?: () => Promise<string>
}

type StreamingToolCall = {
  callId: string
  name: string
  inputJson: string
  started: boolean
}

export class OpenAIResponsesProvider implements Provider {
  readonly id: ProviderId = 'openai'
  readonly model: string
  readonly supportsTools: boolean
  private accessToken: string
  private readonly baseUrl: string
  private readonly accountId?: string
  private readonly originator: string
  private readonly tools: OpenAIToolDefinition[]
  private readonly maxRetries?: number
  private readonly refresh?: () => Promise<string>

  constructor(opts: OpenAIResponsesProviderOptions) {
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.accessToken = opts.accessToken
    this.accountId = opts.accountId
    this.originator = opts.originator ?? 'codex_cli_rs'
    this.tools = opts.tools ?? []
    this.maxRetries = opts.maxRetries
    this.refresh = opts.refresh
    this.supportsTools = this.tools.length > 0
  }

  async *complete(
    messages: Message[],
    signal: AbortSignal,
    options: ProviderCompleteOptions = {},
  ): AsyncIterable<StreamEvent> {
    if (!this.accessToken) {
      const error = new ProviderError('missing OAuth access token for openai (sign in again via the model picker)')
      yield { type: 'error', message: error.message }
      return
    }

    if (hasImageBlocks(messages) && !supportsOpenAIImages(this.model)) {
      yield { type: 'error', message: `image input is not enabled for ${this.model}` }
      return
    }

    let attempt = 0
    while (true) {
      attempt += 1
      let body: string
      try {
        body = JSON.stringify(await buildResponsesBody({
          model: this.model,
          messages,
          tools: this.tools,
          maxOutputTokens: options.maxTokens,
        }))
      } catch (err: unknown) {
        if (err instanceof ImageLoadError) {
          yield { type: 'error', message: err.message }
          return
        }
        throw err
      }

      let response: Response
      try {
        response = yield* fetchWithRetryStreamEvents(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: this.requestHeaders(),
          body,
        }, { signal, maxRetries: this.maxRetries, rateLimitResetProvider: 'openai-compatible' })
      } catch (err: unknown) {
        if (signal.aborted) return
        yield { type: 'error', message: networkErrorMessage(this.baseUrl, err) }
        return
      }

      if (response.status === 401 && this.refresh && attempt === 1) {
        try {
          this.accessToken = await this.refresh()
          continue
        } catch (refreshErr) {
          const message = refreshErr instanceof Error ? refreshErr.message : String(refreshErr)
          yield { type: 'error', message: `OpenAI sign-in expired and refresh failed: ${message}` }
          return
        }
      }

      if (!response.ok) {
        const error = await providerErrorFromResponse('openai', response)
        yield { type: 'error', message: error.message }
        return
      }
      if (!response.body) {
        yield { type: 'error', message: 'empty response body' }
        return
      }

      yield* this.parseStream(response.body, signal)
      return
    }
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${this.accessToken}`,
      originator: this.originator,
    }
    if (this.accountId) headers['chatgpt-account-id'] = this.accountId
    return headers
  }

  private async *parseStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const toolCalls = new Map<string, StreamingToolCall>()
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    let stopReason: DoneStopReason = 'unknown'

    try {
      for await (const frame of iterSseEvents(body, signal, READ_TIMEOUT_MS)) {
        const eventName = frame.event ?? ''
        if (!frame.data || frame.data === '[DONE]') continue
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(frame.data) as Record<string, unknown>
        } catch {
          continue
        }

        switch (eventName) {
          case 'response.output_text.delta': {
            const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
            if (delta) yield { type: 'text', delta }
            break
          }
          case 'response.reasoning_summary_text.delta':
          case 'response.reasoning.delta':
          case 'response.reasoning_text.delta': {
            const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
            if (delta) yield { type: 'thinking', delta }
            break
          }
          case 'response.output_item.added': {
            const item = (parsed.item ?? {}) as Record<string, unknown>
            if (item.type === 'function_call') {
              const callId = pickString(item.call_id) ?? pickString(item.id) ?? `tool-${toolCalls.size}`
              const name = pickString(item.name) ?? ''
              toolCalls.set(callId, { callId, name, inputJson: '', started: false })
              if (name) {
                toolCalls.get(callId)!.started = true
                yield { type: 'tool_use_start', id: callId, name }
              }
            }
            break
          }
          case 'response.function_call_arguments.delta': {
            const callId = resolveCallId(parsed, toolCalls)
            const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
            if (!callId || !delta) break
            const existing = toolCalls.get(callId)
            if (!existing) break
            existing.inputJson += delta
            yield { type: 'tool_use_delta', id: callId, delta }
            break
          }
          case 'response.output_item.done': {
            const item = (parsed.item ?? {}) as Record<string, unknown>
            if (item.type === 'function_call') {
              const callId = pickString(item.call_id) ?? pickString(item.id)
              if (!callId) break
              const existing = toolCalls.get(callId)
              const name = pickString(item.name) ?? existing?.name ?? ''
              const argsJson = pickString(item.arguments) ?? existing?.inputJson ?? ''
              stopReason = 'tool_use'
              yield {
                type: 'tool_use_stop',
                id: callId,
                name,
                input: parseToolArguments(argsJson),
              }
              toolCalls.delete(callId)
            }
            break
          }
          case 'response.completed': {
            const usage = (parsed.response as { usage?: Record<string, unknown> } | undefined)?.usage
            const tokens = readUsage(usage)
            if (tokens.input !== undefined) inputTokens = tokens.input
            if (tokens.output !== undefined) outputTokens = tokens.output
            if (stopReason !== 'tool_use') stopReason = 'end_turn'
            break
          }
          case 'response.failed':
          case 'response.error':
          case 'error': {
            const error = parsed.error as { message?: string } | undefined
            const message = error?.message ?? 'Responses API error'
            yield { type: 'error', message }
            return
          }
          case 'response.incomplete': {
            const reason = pickString((parsed.response as { incomplete_details?: { reason?: string } } | undefined)?.incomplete_details?.reason)
            if (reason === 'max_output_tokens') stopReason = 'max_tokens'
            break
          }
          default:
            break
        }
      }
    } catch (err: unknown) {
      if (signal.aborted) return
      yield { type: 'error', message: networkErrorMessage(this.baseUrl, err, 'stream error') }
      return
    }

    if (signal.aborted) return
    yield { type: 'done', inputTokens, outputTokens, stopReason }
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resolveCallId(parsed: Record<string, unknown>, calls: Map<string, StreamingToolCall>): string | undefined {
  return (
    pickString(parsed.call_id)
    ?? pickString(parsed.item_id)
    ?? pickString((parsed.item as Record<string, unknown> | undefined)?.call_id)
    ?? pickString((parsed.item as Record<string, unknown> | undefined)?.id)
    ?? (calls.size === 1 ? Array.from(calls.keys())[0] : undefined)
  )
}

function readUsage(usage: Record<string, unknown> | undefined): { input?: number; output?: number } {
  if (!usage) return {}
  const input = typeof usage.input_tokens === 'number'
    ? usage.input_tokens
    : typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined
  const output = typeof usage.output_tokens === 'number'
    ? usage.output_tokens
    : typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined
  return { input, output }
}

function parseToolArguments(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function networkErrorMessage(baseUrl: string, err: unknown, fallback = 'network error'): string {
  const message = (err as Error).message || fallback
  return `openai request failed at ${baseUrl}: ${message}`
}
