import { getKey } from '../storage/secrets.js'
import type { Message, Provider, ProviderCompleteOptions, StreamEvent } from './contracts.js'
import { ProviderError } from './contracts.js'
import { providerErrorFromResponse } from './errors.js'
import { iterSseFrames } from './sse.js'
import { messageTextContent } from '../utils/messages.js'

type GeminiChunk = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
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

const READ_TIMEOUT_MS = 45_000

export class GeminiProvider implements Provider {
  readonly id = 'gemini' as const
  readonly model: string
  readonly supportsTools = false

  constructor(opts: { model: string }) {
    this.model = opts.model
  }

  async *complete(
    messages: Message[],
    signal: AbortSignal,
    options: ProviderCompleteOptions = {},
  ): AsyncIterable<StreamEvent> {
    const apiKey = await getKey('gemini')
    if (!apiKey) {
      const error = new ProviderError('missing API key for gemini (/doctor to verify)')
      yield { type: 'error', message: error.message }
      return
    }

    const payload = buildGeminiPayload(messages, options)
    const modelName = this.model.replace(/^models\//, '')
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(payload),
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

        const parts = parsed.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (part.text) yield { type: 'text', delta: part.text }
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
    yield { type: 'done', inputTokens, outputTokens }
  }
}

function buildGeminiPayload(messages: Message[], options: ProviderCompleteOptions = {}): {
  contents: Array<{
    role: 'user' | 'model'
    parts: Array<{ text: string }>
  }>
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  generationConfig?: {
    maxOutputTokens?: number
  }
} {
  const systemParts: string[] = []
  const contents: Array<{
    role: 'user' | 'model'
    parts: Array<{ text: string }>
  }> = []

  for (const message of messages) {
    const text = messageTextContent(message).trim()
    if (!text) continue
    if (message.role === 'system') {
      systemParts.push(text)
      continue
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    })
  }

  return {
    contents,
    systemInstruction: systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
    generationConfig: options.maxTokens ? { maxOutputTokens: options.maxTokens } : undefined,
  }
}
