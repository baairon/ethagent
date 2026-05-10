import { getKey } from '../storage/secrets.js'
import type { Message, MessageContentBlock, Provider, ProviderCompleteOptions, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { fetchWithRetryStreamEvents } from './retry.js'
import { iterSseFrames } from './sse.js'

export type GeminiToolDefinition = {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
}

type GeminiPart = {
  text?: string
  functionCall?: {
    name?: string
    args?: Record<string, unknown>
  }
}

type GeminiChunk = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[]
    }
    finishReason?: string
  }>
  promptFeedback?: {
    blockReason?: string
  }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
  }
}

type GeminiContentPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiContentPart[]
}

type GeminiPayload = {
  contents: GeminiContent[]
  systemInstruction?: { parts: Array<{ text: string }> }
  generationConfig?: { maxOutputTokens?: number }
  tools?: Array<{ functionDeclarations: GeminiToolDefinition[] }>
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' } }
}

type DoneStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown'

const READ_TIMEOUT_MS = 45_000

export type GeminiQuotaInfo = {
  retryAfterMs?: number
  metric?: string
  quotaValue?: string
  quotaId?: string
}

export class GeminiProvider implements Provider {
  readonly id = 'gemini' as const
  readonly model: string
  readonly supportsTools: boolean
  private readonly tools: GeminiToolDefinition[]

  constructor(opts: { model: string; tools?: GeminiToolDefinition[] }) {
    this.model = opts.model
    this.tools = opts.tools ?? []
    this.supportsTools = this.tools.length > 0
  }

  async *complete(
    messages: Message[],
    signal: AbortSignal,
    options: ProviderCompleteOptions = {},
  ): AsyncIterable<StreamEvent> {
    const rawApiKey = await getKey('gemini')
    const apiKey = rawApiKey?.trim()
    if (!apiKey) {
      const error = new ProviderError('missing API key for gemini (/doctor to verify)')
      yield { type: 'error', message: error.message }
      return
    }

    const payload = buildGeminiPayload(messages, this.tools, options)
    const modelName = this.model.replace(/^models\//, '')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse`

    let response: Response
    try {
      response = yield* fetchWithRetryStreamEvents(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
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
    let stopReason: DoneStopReason = 'unknown'
    let toolCallIndex = 0
    let sawToolCall = false

    try {
      for await (const frame of iterSseFrames(response.body, signal, READ_TIMEOUT_MS)) {
        let parsed: GeminiChunk
        try {
          parsed = JSON.parse(frame) as GeminiChunk
        } catch {
          continue
        }

        const blockedReason = parsed.promptFeedback?.blockReason
        if (blockedReason) {
          throw new ProviderError(`prompt blocked: ${blockedReason.toLowerCase()}`)
        }

        const candidate = parsed.candidates?.[0]
        const parts = candidate?.content?.parts ?? []
        for (const part of parts) {
          if (part.text) {
            yield { type: 'text', delta: part.text }
            continue
          }
          if (part.functionCall?.name) {
            const id = `gemini-tool-${toolCallIndex}`
            toolCallIndex += 1
            sawToolCall = true
            const name = part.functionCall.name
            const input = part.functionCall.args ?? {}
            yield { type: 'tool_use_start', id, name }
            yield { type: 'tool_use_stop', id, name, input }
          }
        }

        if (candidate?.finishReason) {
          stopReason = normalizeFinishReason(candidate.finishReason, sawToolCall)
        }

        inputTokens = parsed.usageMetadata?.promptTokenCount ?? inputTokens
        outputTokens = parsed.usageMetadata?.candidatesTokenCount ?? outputTokens
      }
    } catch (err: unknown) {
      if (signal.aborted) return
      yield { type: 'error', message: (err as Error).message || 'stream error' }
      return
    }

    if (signal.aborted) return
    if (sawToolCall) stopReason = 'tool_use'
    yield { type: 'done', inputTokens, outputTokens, stopReason }
  }
}

export function buildGeminiPayload(
  messages: Message[],
  tools: GeminiToolDefinition[] = [],
  options: ProviderCompleteOptions = {},
): GeminiPayload {
  const systemParts: string[] = []
  const contents: GeminiContent[] = []
  const toolUseNamesById = new Map<string, string>()

  for (const message of messages) {
    const blocks = normalizeBlocks(message.content)
    if (blocks.length === 0) continue

    if (message.role === 'system') {
      const systemText = blocks
        .filter((block): block is Extract<MessageContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('\n\n')
        .trim()
      if (systemText) systemParts.push(systemText)
      continue
    }

    if (message.role === 'assistant') {
      const parts: GeminiContentPart[] = []
      for (const block of blocks) {
        if (block.type === 'text') {
          parts.push({ text: block.text })
        } else if (block.type === 'tool_use') {
          toolUseNamesById.set(block.id, block.name)
          parts.push({ functionCall: { name: block.name, args: block.input } })
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts })
      continue
    }

    const parts: GeminiContentPart[] = []
    for (const block of blocks) {
      if (block.type === 'text') {
        parts.push({ text: block.text })
      } else if (block.type === 'tool_result') {
        const name = toolUseNamesById.get(block.toolUseId) ?? 'unknown'
        const response: Record<string, unknown> = block.isError
          ? { content: block.content, isError: true }
          : { content: block.content }
        parts.push({ functionResponse: { name, response } })
      }
    }
    if (parts.length > 0) contents.push({ role: 'user', parts })
  }

  const payload: GeminiPayload = { contents }
  if (systemParts.length > 0) {
    payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] }
  }
  if (options.maxTokens) {
    payload.generationConfig = { maxOutputTokens: options.maxTokens }
  }
  if (tools.length > 0) {
    payload.tools = [{ functionDeclarations: tools }]
    payload.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
  }
  return payload
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

function normalizeFinishReason(reason: string, sawToolCall: boolean): DoneStopReason {
  if (sawToolCall) return 'tool_use'
  switch (reason) {
    case 'STOP':
      return 'end_turn'
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'STOP_SEQUENCE':
      return 'stop_sequence'
    default:
      return 'unknown'
  }
}

type GeminiQuotaInfoInternal = GeminiQuotaInfo & { kind: 'quota-failure' | 'rate-limit' }

function readGeminiQuotaInfo(bodyText: string): GeminiQuotaInfoInternal | undefined {
  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    return undefined
  }
  if (Array.isArray(body)) body = body[0]
  if (!body || typeof body !== 'object') return undefined

  const error = (body as { error?: unknown }).error
  if (!error || typeof error !== 'object') return undefined

  const details = (error as { details?: unknown }).details
  if (!Array.isArray(details)) return undefined

  let retryAfterMs: number | undefined
  let metric: string | undefined
  let quotaValue: string | undefined
  let quotaId: string | undefined
  let isQuotaFailure = false

  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const type = (detail as { '@type'?: unknown })['@type']
    if (typeof type !== 'string') continue

    if (/RetryInfo$/.test(type)) {
      const delay = (detail as { retryDelay?: unknown }).retryDelay
      const parsed = parseGoogleDurationMs(delay)
      if (parsed !== undefined) retryAfterMs = parsed
    } else if (/QuotaFailure$/.test(type)) {
      isQuotaFailure = true
      const violations = (detail as { violations?: unknown }).violations
      if (Array.isArray(violations) && violations.length > 0) {
        const first = violations[0] as Record<string, unknown> | undefined
        if (first) {
          const m = first.metric
          const qv = first.quotaValue
          const qi = first.quotaId
          if (typeof m === 'string') metric = m
          if (typeof qv === 'string') quotaValue = qv
          if (typeof qi === 'string') quotaId = qi
        }
      }
    }
  }

  if (!isQuotaFailure && retryAfterMs === undefined) return undefined
  return {
    kind: isQuotaFailure ? 'quota-failure' : 'rate-limit',
    retryAfterMs,
    metric,
    quotaValue,
    quotaId,
  }
}

function parseGoogleDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^(\d+(?:\.\d+)?)s$/.exec(value.trim())
  if (!m) return undefined
  const seconds = Number(m[1])
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined
}

export async function formatGeminiRateLimitMessage(response: Response): Promise<string | undefined> {
  let bodyText = ''
  try { bodyText = await response.text() } catch { return undefined }
  const info = readGeminiQuotaInfo(bodyText)
  if (!info) return undefined
  const exhausted = info.kind === 'quota-failure'
  const isFreeTier = info.metric ? /free_tier/i.test(info.metric) : false
  const parts = [exhausted ? 'gemini quota hit' : 'gemini rate limit']
  if (info.quotaValue) {
    parts.push(isFreeTier ? `(free-tier cap: ${info.quotaValue})` : `(cap: ${info.quotaValue})`)
  } else if (isFreeTier) {
    parts.push('(free-tier cap)')
  }
  if (info.retryAfterMs !== undefined) {
    const seconds = Math.ceil(info.retryAfterMs / 1000)
    parts.push(`— retry in ~${seconds}s`)
  } else if (exhausted && isFreeTier) {
    parts.push('— enable billing on the API key\'s project, or /model to switch')
  } else if (exhausted) {
    parts.push('— /model to switch providers, or wait for the quota window to reset')
  }
  return parts.join(' ')
}
