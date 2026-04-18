import type { Message } from '../providers/contracts.js'

export function systemMessage(content: string): Message {
  return { role: 'system', content }
}

export function userMessage(content: string): Message {
  return { role: 'user', content }
}

export function assistantMessage(content: string): Message {
  return { role: 'assistant', content }
}

export function approximateTokens(messages: Message[]): number {
  let chars = 0
  for (const m of messages) chars += m.content.length
  return Math.ceil(chars / 4)
}
