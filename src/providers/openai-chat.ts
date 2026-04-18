import type { ProviderId } from '../storage/config.js'
import type { Message, Provider, StreamEvent } from './contracts.js'

type Options = {
  id: ProviderId
  model: string
  baseUrl: string
  apiKey?: string
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

  constructor(opts: Options) {
    this.id = opts.id
    this.model = opts.model
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey ?? ''
  }

  async *complete(messages: Message[], signal: AbortSignal): AsyncIterable<StreamEvent> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

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
      const detail = await safeReadText(response)
      yield { type: 'error', message: `HTTP ${response.status}${detail ? `: ${detail}` : ''}` }
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
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.trim().slice(0, 400)
  } catch {
    return ''
  }
}

async function* iterSseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  readTimeoutMs: number,
): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await readWithTimeout(reader, readTimeoutMs)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const payload = extractDataPayload(raw)
        if (payload !== null) yield payload
      }
    }
    const tail = buffer.trim()
    if (tail) {
      const payload = extractDataPayload(tail)
      if (payload !== null) yield payload
    }
  } finally {
    try { reader.releaseLock() } catch { void 0 }
  }
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no response from model in ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([reader.read(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function extractDataPayload(frame: string): string | null {
  const lines = frame.split('\n')
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}
