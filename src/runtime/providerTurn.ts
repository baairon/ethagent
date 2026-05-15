import type { Message, Provider, StreamEvent } from '../providers/contracts.js'
import type { ProviderTurnEvent } from './turnTypes.js'

export async function* runProviderTurn(
  provider: Provider,
  messages: Message[],
  signal: AbortSignal,
): AsyncIterable<ProviderTurnEvent> {
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
  }
}

function normalize(event: StreamEvent): ProviderTurnEvent {
  switch (event.type) {
    case 'text': return { type: 'text', delta: event.delta }
    case 'thinking': return { type: 'thinking', delta: event.delta }
    case 'thinking_end': return { type: 'thinking_end' }
    case 'retry': return event
    case 'tool_use_start': return event
    case 'tool_use_delta': return event
    case 'tool_use_stop': return event
    case 'done': return { type: 'done', stopReason: event.stopReason }
    case 'error': return { type: 'error', message: event.message }
  }
}
