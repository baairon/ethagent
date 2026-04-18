export type SseEvent = {
  event: string | null
  data: string
}

export async function* iterSseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  readTimeoutMs: number,
): AsyncIterable<string> {
  for await (const event of iterSseEvents(body, signal, readTimeoutMs)) {
    yield event.data
  }
}

export async function* iterSseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  readTimeoutMs: number,
): AsyncIterable<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await readWithTimeout(reader, readTimeoutMs)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = findFrameBoundary(buffer)
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        buffer = buffer.slice(boundary + separator.length)
        const event = extractSseEvent(raw)
        if (event) yield event
        boundary = findFrameBoundary(buffer)
      }
    }

    const tail = buffer.trim()
    if (tail) {
      const event = extractSseEvent(tail)
      if (event) yield event
    }
  } finally {
    try { reader.releaseLock() } catch { void 0 }
  }
}

export async function readWithTimeout(
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

export function extractDataPayload(frame: string): string | null {
  return extractSseEvent(frame)?.data ?? null
}

function extractSseEvent(frame: string): SseEvent | null {
  const lines = frame.split(/\r?\n/)
  const dataLines: string[] = []
  let eventName: string | null = null

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || null
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  if (dataLines.length === 0) return null
  return { event: eventName, data: dataLines.join('\n') }
}

function findFrameBoundary(buffer: string): number {
  const match = /\r?\n\r?\n/.exec(buffer)
  return match?.index ?? -1
}
