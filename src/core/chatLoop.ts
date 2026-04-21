import type { Message, Provider, StreamEvent } from '../providers/contracts.js'

export type TurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; delta: string }
  | { type: 'tool_use_stop'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; inputTokens?: number; outputTokens?: number; stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown' }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export async function* runTurn(
  provider: Provider,
  messages: Message[],
  signal: AbortSignal,
): AsyncIterable<TurnEvent> {
  if (signal.aborted) {
    yield { type: 'cancelled' }
    return
  }
  for await (const ev of provider.complete(messages, signal)) {
    if (signal.aborted) {
      yield { type: 'cancelled' }
      return
    }
    yield normalize(ev)
    if (ev.type === 'done' || ev.type === 'error') return
  }
  if (signal.aborted) {
    yield { type: 'cancelled' }
    return
  }
}

function normalize(event: StreamEvent): TurnEvent {
  switch (event.type) {
    case 'text': return { type: 'text', delta: event.delta }
    case 'thinking': return { type: 'thinking', delta: event.delta }
    case 'tool_use_start': return event
    case 'tool_use_delta': return event
    case 'tool_use_stop': return event
    case 'done': return { type: 'done', inputTokens: event.inputTokens, outputTokens: event.outputTokens, stopReason: event.stopReason }
    case 'error': return { type: 'error', message: event.message }
  }
}
