import type { Message, MessageContentBlock } from '../providers/contracts.js'

export function systemMessage(content: string): Message {
  return { role: 'system', content }
}

export function userMessage(content: string | MessageContentBlock[]): Message {
  return { role: 'user', content }
}

export function assistantMessage(content: string | MessageContentBlock[]): Message {
  return { role: 'assistant', content }
}

export function messageTextContent(message: Message): string {
  return typeof message.content === 'string' ? message.content : blocksToText(message.content)
}

export function blocksToText(blocks: MessageContentBlock[]): string {
  return blocks
    .map(block => {
      if (block.type === 'text') return block.text
      if (block.type === 'tool_use') return `[tool use: ${block.name}]`
      return block.isError
        ? `[tool error: ${block.content}]`
        : `[tool result: ${block.content}]`
    })
    .join('\n')
}

export function approximateTokens(messages: Message[]): number {
  let chars = 0
  for (const m of messages) chars += messageTextContent(m).length
  return Math.ceil(chars / 4)
}
